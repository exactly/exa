import { captureException } from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { eq } from "drizzle-orm";
import * as v from "valibot";

import chain, { alchemyChains, chains, previewerAbi } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import {
  borrowLimit,
  fixedRate,
  fixedUtilization,
  floatingUtilization,
  globalUtilization,
  MATURITY_INTERVAL,
  mulDivUp,
  ONE_YEAR,
  WAD,
  withdrawLimit,
} from "@exactly/lib";

import publicClient, { alchemyClient } from "./publicClient";
import { credentials } from "../database/schema";

import type * as schema from "../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";
import type { Chain } from "viem";

const sources = new Map(
  [...chains].map(([id, { previewer }]) => [
    id,
    { previewer, reader: id === chain.id ? publicClient : alchemyClient(alchemyChains.get(id) as Chain) },
  ]),
);

export default async function remember(
  redis: Redis,
  users: readonly string[] | string,
  account: Address,
  chainId: number,
) {
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
  const value = serialize(positions);
  const at = String(Math.floor(Date.now() / 1000));
  const store = (user: string) =>
    Promise.all([
      redis.hset(key(user), { [chainId]: value, [`${chainId}:at`]: at }),
      redis.expire(key(user), 2_592_000),
    ]);
  await (typeof users === "string" ? store(users) : Promise.all(users.map((user) => store(user))));
  return positions;
}

export const key = (user: string) => `liquidity:${user}`;

export function refresh(
  database: NodePgDatabase<typeof schema>,
  redis: Redis,
  account: Address,
  chainId: number,
  holder?: string,
) {
  database.query.credentials
    .findFirst({ columns: { otherPandaId: true, pandaId: true }, where: eq(credentials.account, account) })
    .then(async (credential) => {
      const users = [...new Set([credential?.pandaId, credential?.otherPandaId, holder])].flatMap((user) =>
        user ? [user] : [],
      );
      if (users.length > 0) await remember(redis, users, account, chainId);
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
    if (maturity <= BigInt(timestamp)) return principal;
    const position = data.find(({ market: address }) => address.toLowerCase() === market.toLowerCase());
    if (!position) return 0n;
    const last = timestamp - (timestamp % MATURITY_INTERVAL) + position.maxFuturePools * MATURITY_INTERVAL;
    const pool =
      position.fixedPools.find((fixed) => fixed.maturity === maturity) ??
      (maturity <= BigInt(last) ? { borrowed: 0n, supplied: 0n } : undefined);
    if (!pool) return 0n;
    const time = maturity - BigInt(timestamp);
    const backup = (borrowed: bigint) => (borrowed > pool.supplied ? borrowed - pool.supplied : 0n);
    const uFloating = floatingUtilization(position.floatingAssets, position.floatingDebt);
    const fee = (assets: bigint) => {
      const borrowed = pool.borrowed + assets;
      const rate = fixedRate(
        Number(maturity),
        position.maxFuturePools,
        fixedUtilization(pool.supplied, borrowed, position.floatingAssets),
        uFloating,
        globalUtilization(
          position.floatingAssets,
          position.floatingDebt,
          position.floatingBackupBorrowed + backup(borrowed) - backup(pool.borrowed),
        ),
        position.interestRateModel.parameters,
        timestamp,
      );
      return mulDivUp(assets, rate * time, WAD * ONE_YEAR);
    };
    let low = 0n;
    let high = principal;
    while (low < high) {
      const assets = (low + high + 1n) / 2n;
      if (assets + fee(assets) <= principal) low = assets;
      else high = assets - 1n;
    }
    return low;
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
    maxFuturePools: v.number(),
    floatingAssets: v.bigint(),
    floatingDebt: v.bigint(),
    floatingBackupBorrowed: v.bigint(),
    interestRateModel: v.object({
      parameters: v.object({
        minRate: v.bigint(),
        naturalRate: v.bigint(),
        maxUtilization: v.bigint(),
        naturalUtilization: v.bigint(),
        growthSpeed: v.bigint(),
        sigmoidSpeed: v.bigint(),
        spreadFactor: v.bigint(),
        maturitySpeed: v.bigint(),
        timePreference: v.bigint(),
        fixedAllocation: v.bigint(),
        maxRate: v.bigint(),
      }),
    }),
    fixedPools: v.array(v.object({ maturity: v.bigint(), borrowed: v.bigint(), supplied: v.bigint() })),
  }),
);

type Positions = v.InferOutput<typeof Positions>;
