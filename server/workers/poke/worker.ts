import { createConfiguration, DefaultApi } from "@onesignal/node-onesignal";
import { Analytics } from "@segment/analytics-node";
import { SPAN_STATUS_ERROR, SPAN_STATUS_OK } from "@sentry/core";
import {
  captureException,
  close as closeSentry,
  continueTrace,
  spanToBaggageHeader,
  spanToTraceHeader,
  startSpan,
  withScope,
} from "@sentry/node";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { parse } from "valibot";
import { bytesToBigInt, erc20Abi, hexToBytes } from "viem";

import exaChain, {
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerAddress,
  marketAbi,
  upgradeableModularAccountAbi,
  wethAddress,
} from "@exactly/common/generated/chain";
import stack from "@exactly/common/stack";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import t from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import decodePublicKey from "../../utils/decodePublicKey";
import { sendPushNotification } from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import revertFingerprint from "../../utils/revertFingerprint";
import secret from "../../utils/secret";
import { getWallet } from "../../utils/wallet";
import { attempts as creditAttempts, name as creditName, type Job as Credit } from "../credit/job";

let analytics: Analytics | undefined;
let connection: Redis | undefined;
let credits: Queue<Credit, void, "credit"> | undefined;
let worker: undefined | Worker<Job, void, "poke">;

export function start({
  onesignalKey,
  redisUrl,
  segmentKey,
}: {
  onesignalKey: string;
  redisUrl: string;
  segmentKey: string;
}) {
  if (worker) return worker;
  analytics ??= new Analytics({ writeKey: segmentKey });
  connection ??= new Redis(redisUrl, { maxRetriesPerRequest: null });
  credits ??= new Queue<Credit, void, "credit">(creditName, {
    connection,
    defaultJobOptions: {
      attempts: creditAttempts,
      backoff: { type: "exponential", delay: 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 1000, age: 7 * 24 * 3600 },
    },
  });
  const segment = analytics;
  segment.on("error", (error) => captureException(error, { level: "error" }));
  const onesignal = new DefaultApi(createConfiguration({ restApiKey: onesignalKey }));
  const publisher = credits;
  worker = new Worker<Job, void, "poke">(
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
                const chain = [...NETWORKS.values()].find(({ id }) => id === job.data.chainId);
                if (!chain) throw new Error(`unsupported chain ${job.data.chainId}`);
                const wallet = await getWallet(`${stack}-poker`, chain);
                const isDeployed = !!(await wallet.getCode({ address: job.data.account }));
                span.setAttribute("exa.new", !isDeployed);
                if (!isDeployed) {
                  await wallet.exaSend(
                    { name: "create account", op: "exa.account", attributes: { account: job.data.account } },
                    {
                      address: job.data.factory,
                      functionName: "createAccount",
                      args: [0n, [decodePublicKey(new Uint8Array(hexToBytes(job.data.publicKey)), bytesToBigInt)]],
                      abi: exaAccountFactoryAbi,
                    },
                    chain.id === exaChain.id ? {} : { fees: "auto" },
                  );
                  try {
                    segment.track({
                      event: "AccountFunded",
                      userId: job.data.account,
                      properties: { source: job.data.source },
                    });
                  } catch (error: unknown) {
                    captureException(error, { level: "error" });
                  }
                }
                if (chain.id === exaChain.id) {
                  const marketsByAsset = await publicClient
                    .readContract({ address: exaPreviewerAddress, functionName: "assets", abi: exaPreviewerAbi })
                    .then(
                      (markets) =>
                        new Map<Address, Address>(
                          markets.map(({ asset, market }) => [parse(Address, asset), parse(Address, market)]),
                        ),
                    );
                  const balances = await Promise.all(
                    [...new Set(job.data.assets ?? [ETH, ...marketsByAsset.keys()])]
                      .filter((asset) => asset === ETH || marketsByAsset.has(asset))
                      .map(async (asset) => ({
                        asset,
                        balance:
                          asset === ETH
                            ? await publicClient.getBalance({ address: job.data.account })
                            : await publicClient.readContract({
                                address: asset,
                                functionName: "balanceOf",
                                args: [job.data.account],
                                abi: erc20Abi,
                              }),
                      })),
                  );
                  const hasETH = balances.some(({ asset, balance }) => asset === ETH && balance > 0n);
                  const pending: Address[] = [];
                  let poked = false;
                  for (const [index, { asset, balance }] of balances.entries()) {
                    if (hasETH && asset === WETH) continue;
                    if (balance === 0n) {
                      pending.push(asset);
                      continue;
                    }
                    const receipt = await wallet.exaSend(
                      { name: "poke account", op: "exa.poke", attributes: { account: job.data.account, asset } },
                      asset === ETH
                        ? {
                            address: job.data.account,
                            abi: accountAbi,
                            functionName: "pokeETH",
                          }
                        : {
                            address: job.data.account,
                            abi: accountAbi,
                            functionName: "poke",
                            args: [marketsByAsset.get(asset)!], // eslint-disable-line @typescript-eslint/no-non-null-assertion
                          },
                      { ignore: [NO_BALANCE] },
                    );
                    if (!receipt) {
                      pending.push(asset);
                      continue;
                    }
                    poked = true;
                    if (job.data.origin === "activity") {
                      await job.updateData({
                        ...job.data,
                        assets: [
                          ...pending,
                          ...balances
                            .slice(index + 1)
                            .map(({ asset: remaining }) => remaining)
                            .filter((remaining) => !(hasETH && remaining === WETH)),
                        ],
                      });
                    }
                  }
                  if (job.data.origin === "activity" && pending.length > 0) {
                    await job.updateData({ ...job.data, assets: pending });
                    throw new Error(NO_BALANCE);
                  }
                  if (job.data.origin === "allow" && poked) {
                    await sendPushNotification(
                      {
                        userId: job.data.account,
                        headings: t("Account assets updated"),
                        contents: t("Your funds are ready to use"),
                      },
                      onesignal,
                    ).catch((error: unknown) => captureException(error, { level: "error" }));
                  }
                  if (job.data.origin === "activity") {
                    await startSpan(
                      {
                        name: creditName,
                        op: "queue.publish",
                        attributes: { "messaging.destination.name": creditName },
                      },
                      async (publish) => {
                        const credit = await publisher.add(
                          creditName,
                          {
                            account: job.data.account,
                            sentryBaggage: spanToBaggageHeader(publish),
                            sentryTrace: spanToTraceHeader(publish),
                          },
                          { jobId: `poke-${job.id}` },
                        );
                        publish.setAttribute("messaging.message.id", credit.id);
                        publish.setAttribute(
                          "messaging.message.body.size",
                          Buffer.byteLength(JSON.stringify(credit.data)),
                        );
                      },
                    );
                  }
                }
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
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        const noBalance = error.message === NO_BALANCE;
        captureException(error, {
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
          fingerprint: noBalance ? ["{{ default }}", "NoBalance"] : revertFingerprint(error),
          level: noBalance ? "warning" : "error",
          tags: { queue: name, job: job?.name },
        });
      });
    })
    .on("error", (error) => {
      captureException(error, { level: "error", tags: { queue: name } });
    });
  return worker;
}

async function main() {
  const [onesignalKey, redisUrl, segmentKey] = await Promise.all([
    secret("poke-onesignal-api-key"),
    secret("redis-url"),
    secret("poke-segment-write-key"),
  ]);
  return start({ onesignalKey, redisUrl, segmentKey }).waitUntilReady();
}

const ready = process.env.VITEST ? undefined : main();
ready?.catch((error: unknown) => {
  captureException(error, { level: "fatal", tags: { startup: true, worker: name } });
  process.exitCode = 1;
  return close().catch((error_: unknown) => {
    captureException(error_, { level: "fatal", tags: { close: true, worker: name } });
  });
});

export async function close() {
  await ready?.catch(() => undefined);
  const results = await Promise.allSettled([
    Promise.resolve(analytics?.closeAndFlush()).finally(() => {
      analytics = undefined;
    }),
    closeSentry(),
    Promise.resolve(worker?.close())
      .then(() => {
        worker = undefined;
      })
      .finally(async () => {
        await credits?.close();
        credits = undefined;
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

const ETH = parse(Address, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee");
const NO_BALANCE = "NoBalance()";
const WETH = parse(Address, wethAddress);
const accountAbi = [...exaPluginAbi, ...upgradeableModularAccountAbi, ...auditorAbi, ...marketAbi];
