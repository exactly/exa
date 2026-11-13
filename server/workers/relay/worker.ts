import { captureException } from "@sentry/node";
import { UnrecoverableError } from "bullmq";
import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { parse } from "valibot";
import { erc20Abi, isAddressEqual, parseAbi, parseEventLogs, zeroAddress, type LocalAccount } from "viem";

import chain, { allowlists, mockSwapperAbi, networks } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import { bridgeCompletions, bridges, markets } from "../../database/indexer";
import { own } from "../../supervise";
import { NETWORKS } from "../../utils/alchemy";
import listen from "../../utils/listen";
import revertFingerprint from "../../utils/revertFingerprint";
import createWallet from "../../utils/wallet";
import createQueue from "../queue";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

export default function worker({
  bridger,
  bullmq,
  database,
}: {
  bridger: LocalAccount;
  bullmq: Redis;
  database: NodePgDatabase<typeof schema> & { $client: Pool };
}) {
  if (!chain.testnet) throw new Error("relay outside testnets");
  const destinations = new Map(
    [...NETWORKS.values()].flatMap((network) => {
      const contracts = networks.get(network.id);
      return contracts
        ? [[network.id, { swapper: contracts.swapper, wallet: createWallet(bridger, network) }] as const]
        : [];
    }),
  );
  const deliverable = [
    ...[...destinations.keys()].map((id) => `${id}:${zeroAddress}`),
    ...Object.entries(allowlists).flatMap(([id, list = []]) => list.map((address) => `${id}:${address.toLowerCase()}`)),
  ];
  const queue = createQueue<Job>(name, attempts, bullmq);
  const listener = listen(database.$client, scan, { queue: name });
  return own(
    createWorker<Job, unknown>({
      attempts,
      bullmq,
      failed(job, error) {
        captureException(error, {
          level: "error",
          fingerprint: revertFingerprint(error),
          tags: { queue: name },
          extra: { attempts: job?.attemptsMade, id: job?.id },
        });
      },
      name,
      async process({ data: { amount, asset, chainId, receiver, source, transactionId } }) {
        const destination = destinations.get(chainId);
        if (!destination) throw new UnrecoverableError(`unsupported chain ${chainId}`);
        const origin = destinations.get(source.chainId);
        if (!origin) throw new UnrecoverableError(`unsupported chain ${source.chainId}`);
        const { swapper, wallet } = destination;
        if (
          await wallet.readContract({
            address: swapper,
            abi: mockSwapperAbi,
            functionName: "completed",
            args: [transactionId],
          })
        ) {
          return;
        }
        const native = isAddressEqual(asset, zeroAddress);
        const balance = native
          ? BigInt(amount)
          : await wallet.readContract({ address: asset, abi: erc20Abi, functionName: "balanceOf", args: [swapper] });
        if (balance < BigInt(amount)) {
          await wallet.exaSend(
            { name: "mint bridged asset", op: "exa.mint", attributes: { asset, transactionId } },
            { address: asset, abi: mintAbi, functionName: "mint", args: [swapper, BigInt(amount) - balance] },
            { fees: "auto" },
          );
        }
        const [call] = parseEventLogs({
          abi: mockSwapperAbi,
          eventName: "BridgeMessage",
          args: { transactionId },
          logs: await origin.wallet.getTransactionReceipt({ hash: source.hash }).then(({ logs }) => logs),
        });
        await wallet.exaSend(
          { name: "complete bridge", op: "exa.bridge", attributes: { account: receiver, transactionId } },
          call
            ? {
                address: swapper,
                abi: mockSwapperAbi,
                functionName: "completeBridgeTokensAndCallViaMock",
                args: [transactionId, asset, BigInt(amount), call.args.message],
              }
            : {
                address: swapper,
                abi: mockSwapperAbi,
                functionName: "completeBridgeTokensViaMock",
                args: [transactionId, asset, receiver, BigInt(amount)],
                value: native ? BigInt(amount) : 0n,
              },
          { fees: "auto" },
        );
      },
      ready: listener.ready,
    }),
    () => listener.close(),
    () => queue.close(),
  );

  async function scan() {
    const delivered = sql<string>`left(${bridges.transactionId}, 42)`;
    const pending = await database
      .select({
        amount: bridges.amount,
        asset: delivered,
        chainId: bridges.destinationChainId,
        receiver: bridges.receiver,
        sourceChainId: bridges.chainId,
        hash: bridges.hash,
        transactionId: bridges.transactionId,
      })
      .from(bridges)
      .leftJoin(markets, and(eq(markets.chainId, bridges.destinationChainId), eq(markets.asset, delivered)))
      .leftJoin(
        bridgeCompletions,
        and(
          eq(bridgeCompletions.chainId, bridges.destinationChainId),
          eq(bridgeCompletions.transactionId, bridges.transactionId),
        ),
      )
      .where(
        and(
          isNull(bridgeCompletions.hash),
          inArray(bridges.destinationChainId, [...destinations.keys()].map(BigInt)),
          or(isNotNull(markets.asset), inArray(sql`${bridges.destinationChainId} || ':' || ${delivered}`, deliverable)),
        ),
      );
    await queue.bulk(
      pending.map(({ amount, asset, chainId, hash, receiver, sourceChainId, transactionId }) => ({
        data: {
          amount: String(amount),
          asset: parse(Address, asset),
          chainId: Number(chainId),
          receiver: parse(Address, receiver),
          source: { chainId: sourceChainId, hash },
          transactionId,
        },
        id: `${chainId}-${transactionId}`,
      })),
    );
  }
}

const mintAbi = parseAbi(["function mint(address to, uint256 value)"]);
