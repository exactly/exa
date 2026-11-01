import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext, setExtra, setUser, startSpan } from "@sentry/node";
import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { timingSafeEqual } from "node:crypto";
import { looseObject, number, object, optional, parse, pipe, regex, string, transform, union } from "valibot";
import { BaseError, hexToBigInt, RpcRequestError, size, type PublicClient } from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";

import chain from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import { activityNetworks } from "../utils/alchemy";
import publicClient, { alchemyClient } from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export default function hook({ database, token }: { database: NodePgDatabase<typeof schema>; token: string }) {
  if (!token) throw new Error("missing sponsor token");
  const clients = new Map<number, PublicClient>([[chain.id, publicClient]]);
  const networks = activityNetworks();
  const expected = Buffer.from(token);
  const invalid = validatorHook({ code: "bad sponsor" });
  const app = new Hono().post(
    "/",
    async (c, next) => {
      const received = Buffer.from(c.req.query("token") ?? "");
      if (received.length === expected.length && timingSafeEqual(received, expected)) return next();
      setExtra("exa.ignore", true);
      return c.json({ approved: false }, 200);
    },
    vValidator(
      "json",
      object({
        chainId: pipe(union([number(), string()]), transform(Number)),
        policyId: optional(string()),
        userOperation: looseObject({
          sender: Address,
          initCode: optional(Hex),
          callGasLimit: Quantity,
          preVerificationGas: Quantity,
          maxFeePerGas: Quantity,
          maxPriorityFeePerGas: Quantity,
          paymasterPostOpGasLimit: optional(Quantity),
          signature: optional(Hex),
        }),
      }),
      (result, c) => invalid(result, c) && c.json({ approved: false }, 200),
    ),
    (c) => {
      const { chainId, policyId, userOperation } = c.req.valid("json");
      const { sender } = userOperation;
      const callGasLimit = hexToBigInt(userOperation.callGasLimit);
      const preVerificationGas = hexToBigInt(userOperation.preVerificationGas);
      const maxFeePerGas = hexToBigInt(userOperation.maxFeePerGas);
      const maxPriorityFeePerGas = hexToBigInt(userOperation.maxPriorityFeePerGas);
      const postOpGasLimit = hexToBigInt(userOperation.paymasterPostOpGasLimit ?? "0x0");
      const signatureSize = size(userOperation.signature ?? "0x");
      const entryPoint = userOperation.initCode === undefined ? entryPoint07Address : entryPoint06Address;
      setUser({ id: sender });
      setContext("sponsor", { chainId, policyId, userOperation });
      return startSpan(
        {
          name: "sponsor",
          op: "sponsor.check",
          attributes: {
            "sponsor.chain": chainId,
            "sponsor.sender": sender,
            "sponsor.entrypoint": entryPoint,
            "sponsor.callGasLimit": Number(callGasLimit),
            "sponsor.maxFeePerGas": Number(maxFeePerGas),
            "sponsor.maxPriorityFeePerGas": Number(maxPriorityFeePerGas),
            "sponsor.paymasterPostOpGasLimit": Number(postOpGasLimit),
            "sponsor.preVerificationGas": Number(preVerificationGas),
            "sponsor.signature.size": signatureSize,
          },
        },
        async (span) => {
          let timer: NodeJS.Timeout | undefined;
          const denial = await Promise.race([
            check(),
            new Promise<Denial>((resolve) => {
              timer = setTimeout(resolve, 3000, deny("slow check"));
            }),
          ]).finally(() => clearTimeout(timer));
          if (denial) {
            span.setAttributes({ "sponsor.approved": false, "sponsor.reason": denial.reason });
            captureException(new Error(denial.reason), {
              level: "warning",
              extra: { chainId, sender, ...denial.extra },
            });
            return c.json({ approved: false }, 200);
          }
          span.setAttribute("sponsor.approved", true);
          return c.json({ approved: true }, 200);
        },
      );

      async function check() {
        const client = clients.get(chainId) ?? connect(chainId);
        if (!client) return deny("unsupported chain");
        if (signatureSize > 2048) return deny("excessive signature", { signatureSize });
        if (postOpGasLimit > 75_000n) {
          return deny("excessive post-op gas", { paymasterPostOpGasLimit: String(postOpGasLimit) });
        }
        const credential = await startSpan({ name: "find sender", op: "sponsor.sender" }, async (child) => {
          const found = await database.query.credentials.findFirst({
            columns: { id: true },
            where: or(eq(credentials.account, sender), eq(credentials.id, sender)),
          });
          child.setAttribute("sponsor.known", !!found);
          return found;
        });
        if (!credential) return deny("unknown sender");
        const [gasPrice, priorityFee, estimate] = await Promise.all([
          startSpan({ name: "eth_gasPrice", op: "sponsor.gasPrice" }, async (child) => {
            const price = await client.getGasPrice();
            child.setAttributes({
              "sponsor.gasPrice": Number(price),
              "sponsor.gasPrice.ratio": Number(maxFeePerGas) / Number(price),
            });
            return price;
          }),
          startSpan({ name: "priority fee", op: "sponsor.priorityFee" }, async (child) => {
            const [network, bundler] = await Promise.all([
              client.request({ method: "eth_maxPriorityFeePerGas" }).then((fee) => hexToBigInt(fee)),
              client
                .request<{ ReturnType: unknown }>({ method: "rundler_maxPriorityFeePerGas", params: [] }) // cspell:ignore rundler
                .then((fee) => hexToBigInt(parse(Quantity, fee))),
            ]);
            child.setAttributes({
              "sponsor.priorityFee.network": Number(network),
              "sponsor.priorityFee.bundler": Number(bundler),
              "sponsor.priorityFee.ratio": Number(maxPriorityFeePerGas) / Math.max(Number(network), Number(bundler)),
            });
            return { network, bundler };
          }),
          preVerificationGas || callGasLimit
            ? startSpan({ name: "eth_estimateUserOperationGas", op: "sponsor.estimate" }, (child) =>
                client
                  .request<{ ReturnType: unknown }>({
                    method: "eth_estimateUserOperationGas",
                    params: [{ ...userOperation, preVerificationGas: "0x0", callGasLimit: "0x0" }, entryPoint],
                  })
                  .then((result) => {
                    const gas = parse(Estimate, result);
                    child.setAttributes({
                      "sponsor.estimate": Number(gas.preVerificationGas),
                      "sponsor.estimate.ratio": Number(preVerificationGas) / Number(gas.preVerificationGas),
                      "sponsor.estimate.callGasLimit": Number(gas.callGasLimit),
                      "sponsor.estimate.callGasLimit.ratio": Number(callGasLimit) / Number(gas.callGasLimit),
                    });
                    return gas;
                  })
                  .catch((error: unknown) => {
                    if (!(error instanceof BaseError) || !error.walk((cause) => cause instanceof RpcRequestError)) {
                      throw error;
                    }
                    child.setAttribute("sponsor.estimate.error", error.shortMessage);
                    return error;
                  }),
              )
            : { preVerificationGas: 0n, callGasLimit: 0n },
        ]);
        if (estimate instanceof BaseError) return deny("rejected operation", { error: estimate.shortMessage });
        if (maxFeePerGas > 10n * gasPrice) {
          return deny("excessive fee", { maxFeePerGas: String(maxFeePerGas), gasPrice: String(gasPrice) });
        }
        if (
          5n * maxPriorityFeePerGas > 6n * priorityFee.network &&
          5n * maxPriorityFeePerGas > 6n * priorityFee.bundler
        ) {
          return deny("excessive tip", {
            maxPriorityFeePerGas: String(maxPriorityFeePerGas),
            network: String(priorityFee.network),
            bundler: String(priorityFee.bundler),
          });
        }
        if (preVerificationGas > 2n * estimate.preVerificationGas) {
          return deny("excessive pre-verification gas", {
            preVerificationGas: String(preVerificationGas),
            estimate: String(estimate.preVerificationGas),
          });
        }
        if (callGasLimit > 2n * estimate.callGasLimit) {
          return deny("excessive call gas", {
            callGasLimit: String(callGasLimit),
            estimate: String(estimate.callGasLimit),
          });
        }
      }
    },
  );
  return { app, ready: Promise.resolve() };

  function connect(id: number) {
    const network = [...networks.values()].find((current) => current.id === id);
    if (!network) return;
    const client = alchemyClient(network);
    clients.set(id, client);
    return client;
  }
}

const Quantity = pipe(Hex, regex(/^0x[\da-f]+$/i, "bad quantity"));

const Gas = pipe(
  Quantity,
  transform((gas) => hexToBigInt(gas)),
);

const Estimate = object({ callGasLimit: Gas, preVerificationGas: Gas });

function deny(reason: string, extra: Record<string, unknown> = {}) {
  return { reason, extra };
}

type Denial = ReturnType<typeof deny>;
