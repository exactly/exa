import { captureException } from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { eq } from "drizzle-orm";
import * as v from "valibot";

import chain, { alchemyChains, networks, previewerAbi } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { borrowLimit, ONE_YEAR, WAD, withdrawLimit } from "@exactly/lib";

import publicClient, { alchemyClient } from "./publicClient";
import { credentials } from "../database/schema";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";
import type { Chain } from "viem";

const sources = new Map(
  [...networks].map(([id, { previewer }]) => [
    id,
    { previewer, reader: id === chain.id ? publicClient : alchemyClient(alchemyChains.get(id) as Chain) },
  ]),
);

export default async function remember(redis: Redis, user: string, account: Address, chainId: number) {
  const source = sources.get(chainId);
  if (!source) throw new Error(`unsupported network ${chainId}`);
  const positions = v.parse(
    Positions,
    await source.reader.readContract({
      address: source.previewer,
      abi: previewerAbi,
      functionName: "exactly",
      args: [account],
    }),
  );
  await redis.hset(key(user), String(chainId), serialize(positions));
  return positions;
}

export const key = (user: string) => `liquidity:${user}`;

export function refresh(database: NodePgDatabase<typeof schema>, redis: Redis, account: Address, chainId: number) {
  database.query.credentials
    .findFirst({ columns: { pandaId: true }, where: eq(credentials.account, account) })
    .then(async (credential) => {
      if (credential?.pandaId) await remember(redis, credential.pandaId, account, chainId);
    })
    .catch((error: unknown) => captureException(error, { level: "warning", tags: { chainId } }));
}

export function limit(
  positions: Positions | string | undefined,
  market: string,
  maturity: bigint | undefined,
  timestamp: number,
) {
  if (positions === undefined) return;
  try {
    const data = typeof positions === "string" ? v.parse(Positions, deserialize(positions)) : positions;
    if (maturity === undefined) return withdrawLimit(data, market, WAD, timestamp);
    const principal = borrowLimit(data, market, WAD, timestamp);
    const rate =
      data
        .flatMap(({ market: address, fixedPools }) =>
          address.toLowerCase() === market.toLowerCase() ? fixedPools : [],
        )
        .find((pool) => pool.maturity === maturity)?.minBorrowRate ?? 0n;
    const time = maturity > BigInt(timestamp) ? maturity - BigInt(timestamp) : 0n;
    return (principal * WAD * ONE_YEAR) / (WAD * ONE_YEAR + rate * time);
  } catch (error: unknown) {
    captureException(error, { level: "warning" });
  }
}

const Positions = v.array(
  v.object({
    market: Address,
    decimals: v.number(),
    usdPrice: v.bigint(),
    adjustFactor: v.bigint(),
    isCollateral: v.boolean(),
    floatingBorrowAssets: v.bigint(),
    floatingDepositAssets: v.bigint(),
    fixedBorrowPositions: v.array(
      v.object({ maturity: v.bigint(), position: v.object({ principal: v.bigint(), fee: v.bigint() }) }),
    ),
    penaltyRate: v.bigint(),
    fixedPools: v.array(v.object({ maturity: v.bigint(), minBorrowRate: v.bigint() })),
  }),
);

type Positions = v.InferOutput<typeof Positions>;
