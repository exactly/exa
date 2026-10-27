import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext, setExtra, setUser, startSpan } from "@sentry/node";
import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { createHmac, timingSafeEqual } from "node:crypto";
import { looseObject, number, object, optional, parse, pipe, regex, string, transform, union } from "valibot";
import { hexToBigInt, size, type PublicClient } from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";

import chain, { alchemyChains } from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import publicClient, { alchemyClient } from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

export default function hook({
  database,
  signingKey,
}: {
  database: NodePgDatabase<typeof schema>;
  signingKey: string;
}) {
  if (!signingKey) throw new Error("missing sponsor signing key");
  const clients = new Map<number, PublicClient>([[chain.id, publicClient]]);
  const invalid = validatorHook({ code: "bad sponsor" });
  const app = new Hono().post(
    "/",
    async (c, next) => {
      const expected = Buffer.from(
        createHmac("sha256", signingKey)
          .update(await c.req.text())
          .digest("hex"),
      );
      const received = Buffer.from(c.req.header("x-alchemy-signature") ?? "");
      if (received.length === expected.length && timingSafeEqual(received, expected)) return next();
      setExtra("exa.ignore", true);
      return c.json({ code: "invalid signature" }, 401);
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
          verificationGasLimit: optional(Quantity),
          preVerificationGas: Quantity,
          maxFeePerGas: Quantity,
          maxPriorityFeePerGas: Quantity,
          paymasterVerificationGasLimit: optional(Quantity),
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
      const gas =
        callGasLimit +
        hexToBigInt(userOperation.verificationGasLimit ?? "0x0") +
        preVerificationGas +
        hexToBigInt(userOperation.paymasterVerificationGasLimit ?? "0x0") +
        postOpGasLimit;
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
            "sponsor.gas": Number(gas),
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
        if (gas > 20_000_000n) return deny("excessive gas", { gas: String(gas) });
        const credential = await startSpan({ name: "find sender", op: "sponsor.sender" }, async (child) => {
          const found = await database.query.credentials.findFirst({
            columns: { id: true },
            where: or(eq(credentials.account, sender), eq(credentials.id, sender)),
          });
          child.setAttribute("sponsor.known", !!found);
          return found;
        });
        if (!credential) return deny("unknown sender");
        const [gasPrice, priorityFee] = await Promise.all([
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
        ]);
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
      }
    },
  );
  return { app, ready: Promise.resolve() };

  function connect(id: number) {
    const network = alchemyChains.get(id);
    if (!network?.smartAccount) return;
    const client = alchemyClient(network);
    clients.set(id, client);
    return client;
  }
}

const Quantity = pipe(Hex, regex(/^0x[\da-f]+$/i, "bad quantity"));

function deny(reason: string, extra: Record<string, unknown> = {}) {
  return { reason, extra };
}

type Denial = ReturnType<typeof deny>;
