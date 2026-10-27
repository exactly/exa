import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext, setExtra, setUser, startSpan } from "@sentry/node";
import { eq, or } from "drizzle-orm";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createHmac, timingSafeEqual } from "node:crypto";
import { looseObject, number, object, optional, parse, pipe, regex, string, transform, union } from "valibot";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeFunctionData,
  hexToBigInt,
  http,
  parseAbi,
  size,
  type Hex as Data,
  type PublicClient,
} from "viem";
import { entryPoint06Address, entryPoint07Address } from "viem/account-abstraction";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { alchemyChains } from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import { credentials } from "../database/schema";
import publicClient, { captureRequests, Requests } from "../utils/publicClient";
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
    bodyLimit({
      maxSize: 64 * 1024,
      onError: (c) => {
        setExtra("exa.ignore", true);
        return c.json({ approved: false }, 200);
      },
    }),
    async (c, next) => {
      const expected = Buffer.from(
        createHmac("sha256", signingKey)
          .update(Buffer.from(await c.req.arrayBuffer()))
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
          factory: optional(Hex),
          factoryData: optional(Hex),
          callData: Hex,
          callGasLimit: Quantity,
          verificationGasLimit: optional(Quantity),
          preVerificationGas: Quantity,
          maxFeePerGas: Quantity,
          maxPriorityFeePerGas: Quantity,
          paymasterVerificationGasLimit: optional(Quantity),
          paymasterPostOpGasLimit: optional(Quantity),
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
      const length =
        2816 +
        size(userOperation.callData) +
        size(userOperation.initCode ?? "0x") +
        size(userOperation.factory ?? "0x") +
        size(userOperation.factoryData ?? "0x");
      const overhead = 41_000n + 17n * BigInt(length);
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
              fingerprint: ["{{ default }}", denial.reason],
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
        if (postOpGasLimit > 75_000n) {
          return deny("excessive post-op gas", { paymasterPostOpGasLimit: String(postOpGasLimit) });
        }
        if (gas > 20_000_000n) return deny("excessive gas", { gas: String(gas) });
        const credential = await startSpan({ name: "find sender", op: "sponsor.sender" }, async (child) => {
          const found = await database.query.credentials.findFirst({
            columns: { id: true, pandaId: true, otherPandaId: true },
            where: or(eq(credentials.account, sender), eq(credentials.id, sender)),
          });
          child.setAttributes({ "sponsor.known": !!found, "sponsor.kyc": !!(found?.pandaId ?? found?.otherPandaId) });
          return found;
        });
        if (!credential) return deny("unknown sender");
        const tipBound = credential.id === sender && (credential.pandaId ?? credential.otherPandaId) ? 15n : 12n;
        const [gasPrice, priorityFee, baseFee, dataFee] = await Promise.all([
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
          client
            .request<{ ReturnType: unknown }>({ method: "eth_getBlockByNumber", params: ["latest", false] })
            .then((block) => hexToBigInt(parse(Block, block).baseFeePerGas ?? "0x0")),
          startSpan({ name: "data fee", op: "sponsor.dataFee" }, async (child) => {
            const [optimism, arbitrum] = await Promise.all([
              read(
                client,
                "0x420000000000000000000000000000000000000F",
                encodeFunctionData({ abi, functionName: "getL1FeeUpperBound", args: [BigInt(length)] }),
              ).then((data) =>
                data === "0x" ? 0n : decodeFunctionResult({ abi, functionName: "getL1FeeUpperBound", data }),
              ),
              read(
                client,
                "0x000000000000000000000000000000000000006C",
                encodeFunctionData({ abi, functionName: "getPricesInWei" }),
              ).then((data) =>
                data === "0x"
                  ? 0n
                  : decodeFunctionResult({ abi, functionName: "getPricesInWei", data })[1] * BigInt(length + 140),
              ),
            ]);
            child.setAttributes({
              "sponsor.dataFee.optimism": Number(optimism),
              "sponsor.dataFee.arbitrum": Number(arbitrum),
            });
            return optimism + arbitrum;
          }),
        ]);
        if (maxFeePerGas > 10n * gasPrice) {
          return deny("excessive fee", { maxFeePerGas: String(maxFeePerGas), gasPrice: String(gasPrice) });
        }
        if (
          10n * maxPriorityFeePerGas > tipBound * priorityFee.network &&
          10n * maxPriorityFeePerGas > tipBound * priorityFee.bundler
        ) {
          return deny("excessive tip", {
            maxPriorityFeePerGas: String(maxPriorityFeePerGas),
            network: String(priorityFee.network),
            bundler: String(priorityFee.bundler),
          });
        }
        const excess = preVerificationGas - 2n * overhead;
        if (excess * maxFeePerGas > 2n * dataFee && excess * (baseFee + maxPriorityFeePerGas) > 2n * dataFee) {
          return deny("excessive pre-verification gas", {
            preVerificationGas: String(preVerificationGas),
            overhead: String(overhead),
            dataFee: String(dataFee),
            baseFee: String(baseFee),
          });
        }
      }
    },
  );
  return { app, ready: Promise.resolve() };

  function connect(id: number) {
    const network = alchemyChains.get(id);
    if (!network?.smartAccount) return;
    const client = createPublicClient({
      chain: network,
      transport: http(`${network.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
        batch: true,
        async onFetchRequest(request) {
          captureRequests(parse(Requests, await request.json()));
        },
      }),
    });
    clients.set(id, client);
    return client;
  }
}

async function read(client: PublicClient, to: Data, data: Data) {
  return parse(
    Hex,
    await client.request<{ ReturnType: unknown }>({ method: "eth_call", params: [{ to, data }, "latest"] }),
  );
}

const abi = parseAbi([
  "function getL1FeeUpperBound(uint256) view returns (uint256)",
  "function getPricesInWei() view returns (uint256, uint256, uint256, uint256, uint256, uint256)",
]);

const Quantity = pipe(Hex, regex(/^0x[\da-f]+$/i, "bad quantity"));

const Block = looseObject({ baseFeePerGas: optional(Quantity) });

function deny(reason: string, extra: Record<string, unknown> = {}) {
  return { reason, extra };
}

type Denial = ReturnType<typeof deny>;
