import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import { captureException, close as closeSentry, continueTrace, startSpan } from "@sentry/node";
import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { array, number, object, parse, tuple } from "valibot";
import { toHex } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain, { refunderAddress, usdcAddress } from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address, Hex } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import secret from "../../utils/secret";
import ServiceError from "../../utils/ServiceError";
import { getWallet } from "../../utils/wallet";

const token = parse(Address, chain.testnet ? "0x29684075a3C86ea11D9964BcAf0F956e801396bD" : usdcAddress);

let connection: Redis | undefined;
let worker: undefined | Worker<Job, void, "refund">;

export function start({ pandaKey, pandaUrl, redisUrl }: { pandaKey: string; pandaUrl: string; redisUrl: string }) {
  if (worker) return worker;
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  worker = new Worker<Job, void, "refund">(
    name,
    (job) => {
      const run = () =>
        startSpan({ name: `${job.name} worker`, forceTransaction: true }, (parent) =>
          startSpan(
            {
              attributes: {
                "messaging.destination.name": name,
                "messaging.message.body.size": Buffer.byteLength(JSON.stringify(job.data)),
                "messaging.message.id": job.id,
                "messaging.message.receive.latency": Date.now() - job.timestamp,
                "messaging.message.retry.count": job.attemptsMade,
              },
              name: job.name,
              op: "queue.process",
            },
            async (span) => {
              try {
                const wallet = await getWallet(`${stack}-refunder`);
                const response = await fetch(
                  `${pandaUrl}/issuing/tenants/signatures/withdrawals?token=${token}&amount=${job.data.amount}&recipientAddress=${refunderAddress}&adminAddress=${wallet.account.address}&chainId=${chain.id}`,
                  {
                    headers: { "Api-Key": pandaKey, accept: "application/json", "content-type": "application/json" },
                    method: "GET",
                    signal: AbortSignal.timeout(10_000),
                  },
                );
                if (!response.ok) {
                  const raw = await response.text();
                  throw new ServiceError("Panda", response.status, raw, undefined, raw);
                }
                const { parameters } = parse(
                  object({ parameters: tuple([Address, Address, number(), Address, number(), array(number()), Hex]) }),
                  JSON.parse(new TextDecoder().decode(await response.arrayBuffer())),
                );
                await wallet.exaSend(
                  { name: "panda.withdraw", op: "panda.withdraw", attributes: { account: refunderAddress } },
                  {
                    address: parse(
                      Address,
                      {
                        [baseSepolia.id]: "0x54d02DcB38B76A67dC9368D8457D1F384B865c70",
                        [optimismSepolia.id]: "0x4A6321D536a510cfE95A919DE869C4179bFb4856",
                        [base.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                        [optimism.id]: "0x753Fb325Ca30f229E616eA8E6Eb620D0Bb29D0Df",
                      }[chain.id],
                    ),
                    args: [
                      parameters[0],
                      parameters[1],
                      BigInt(parameters[2]),
                      parameters[3],
                      BigInt(parameters[4]),
                      toHex(Buffer.from(parameters[5])),
                      parameters[6],
                    ],
                    abi: [
                      {
                        inputs: [
                          { internalType: "address", name: "_collateralProxy", type: "address" },
                          { internalType: "address", name: "_asset", type: "address" },
                          { internalType: "uint256", name: "_amount", type: "uint256" },
                          { internalType: "address", name: "_recipient", type: "address" },
                          { internalType: "uint256", name: "_expiresAt", type: "uint256" },
                          { internalType: "bytes32", name: "_salt", type: "bytes32" },
                          { internalType: "bytes", name: "_signature", type: "bytes" },
                        ],
                        name: "withdrawAsset",
                        outputs: [],
                        stateMutability: "nonpayable",
                        type: "function",
                      },
                    ],
                    functionName: "withdrawAsset",
                  },
                );
                span.setStatus({ code: SPAN_STATUS_OK });
                parent.setStatus({ code: SPAN_STATUS_OK });
              } catch (error: unknown) {
                const status = {
                  code: SPAN_STATUS_ERROR,
                  message: error instanceof Error ? error.message : "queue process failed",
                } as const;
                span.setStatus(status);
                parent.setStatus(status);
                throw error;
              }
            },
          ),
        );
      return job.data.sentryTrace || job.data.sentryBaggage
        ? continueTrace({ sentryTrace: job.data.sentryTrace, baggage: job.data.sentryBaggage }, run)
        : run();
    },
    { connection, limiter: { max: 10, duration: 1000 } },
  )
    .on("failed", (job, error) => {
      if (job && job.attemptsMade < (job.opts.attempts ?? attempts)) return;
      captureException(error, {
        extra: { amount: job?.data.amount, attempts: job?.attemptsMade, id: job?.id, recipient: refunderAddress },
        level: "error",
        tags: { queue: name, job: job?.name },
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    });
  return worker;
}

async function main() {
  const [pandaKey, pandaUrl, redisUrl] = await Promise.all([
    secret("refund-panda-api-key"),
    secret("panda-api-url"),
    secret("redis-url"),
  ]);
  return start({ pandaKey, pandaUrl, redisUrl }).waitUntilReady();
}

const ready = process.env.VITEST ? undefined : main();
ready?.catch((error: unknown) => {
  captureException(error, { level: "fatal", tags: { startup: true, worker: "refund" } });
  process.exitCode = 1;
  return close().catch((error_: unknown) => {
    captureException(error_, { level: "fatal", tags: { close: true, worker: "refund" } });
  });
});

export async function close() {
  await ready?.catch(() => undefined);
  const results = await Promise.allSettled([
    closeSentry(),
    Promise.resolve(worker?.close())
      .then(() => {
        worker = undefined;
      })
      .finally(async () => {
        await connection?.quit();
        connection = undefined;
      }),
  ]);
  if (results.some((result) => result.status === "rejected")) throw new Error("closing services failed");
}

if (!process.env.VITEST) {
  ["SIGINT", "SIGTERM"].map((code) => {
    process.on(code, () => {
      close()
        .then(() => process.exit(0)) // eslint-disable-line n/no-process-exit
        .catch(() => process.exit(1)); // eslint-disable-line n/no-process-exit
    });
  });
}
