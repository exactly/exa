import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { parse } from "valibot";
import { padHex } from "viem";
import { moonbeamDev } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import chain, { marketUSDCAddress, marketWETHAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import {
  fixedRate,
  fixedUtilization,
  floatingUtilization,
  globalUtilization,
  MATURITY_INTERVAL,
  mulDivUp,
  ONE_YEAR,
  WAD,
} from "@exactly/lib";

import database, { credentials } from "../../database";
import remember, { key, limit, refresh } from "../../utils/liquidity";
import redis from "../../utils/redis";

const account = parse(Address, padHex("0x1234", { size: 20 }));

describe("remember", () => {
  it("stores positions on every network", async () => {
    const [local, remote] = await Promise.all([
      remember(redis, "remember", account, chain.id),
      remember(redis, "remember", account, moonbeamDev.id),
    ]);

    expect(local.map(({ market }) => market)).toContain(marketUSDCAddress);
    expect(local.every(({ floatingDepositAssets }) => floatingDepositAssets === 0n)).toBe(true);
    await expect(redis.hgetall(key("remember"))).resolves.toStrictEqual({
      [chain.id]: serialize(local),
      [`${chain.id}:at`]: expect.stringMatching(/^\d+$/) as string,
      [moonbeamDev.id]: serialize(remote),
      [`${moonbeamDev.id}:at`]: expect.stringMatching(/^\d+$/) as string,
    });
    await expect(redis.ttl(key("remember"))).resolves.toBeGreaterThan(0);
    expect(deserialize(serialize(local))).toStrictEqual(local);
  });

  it("rejects unsupported networks", async () => {
    await expect(remember(redis, "unsupported", account, 1)).rejects.toThrow("unsupported network 1");
    await expect(redis.exists(key("unsupported"))).resolves.toBe(0);
  });
});

describe("refresh", () => {
  it("stores positions of card users", async () => {
    await database.insert(credentials).values({
      id: "refresh",
      publicKey: new Uint8Array(),
      account,
      factory: account,
      pandaId: "refresh",
    });

    refresh(database, redis, account, chain.id);

    await vi.waitFor(() => expect(redis.hexists(key("refresh"), String(chain.id))).resolves.toBe(1));
  });

  it("stores positions under the user of each program", async () => {
    const both = parse(Address, padHex("0x5679", { size: 20 }));
    await database.insert(credentials).values({
      id: "refresh-both",
      publicKey: new Uint8Array(),
      account: both,
      factory: both,
      pandaId: "refresh-home",
      otherPandaId: "refresh-other",
    });

    refresh(database, redis, both, chain.id);

    await vi.waitFor(() =>
      expect(
        Promise.all([
          redis.hexists(key("refresh-home"), String(chain.id)),
          redis.hexists(key("refresh-other"), String(chain.id)),
        ]),
      ).resolves.toStrictEqual([1, 1]),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips accounts without card", async () => {
    const other = parse(Address, padHex("0x5678", { size: 20 }));
    await database
      .insert(credentials)
      .values({ id: "no-card", publicKey: new Uint8Array(), account: other, factory: other });
    const findFirst = vi.spyOn(database.query.credentials, "findFirst");

    refresh(database, redis, other, chain.id);

    await vi.waitFor(() => expect(findFirst).toHaveBeenCalledOnce());
    await expect(findFirst.mock.results[0]?.value).resolves.toStrictEqual({ otherPandaId: null, pandaId: null });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports failures", async () => {
    const error = new Error("database down");
    vi.spyOn(database.query.credentials, "findFirst").mockRejectedValueOnce(error);

    refresh(database, redis, account, chain.id);

    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
        level: "warning",
        tags: { chainId: chain.id },
      }),
    );
  });
});

describe("limit", () => {
  const usdc = {
    market: parse(Address, marketUSDCAddress),
    decimals: 6,
    usdPrice: 10n ** 18n,
    adjustFactor: 9n * 10n ** 17n,
    isCollateral: true,
    floatingBorrowAssets: 0n,
    floatingDepositAssets: 100_000_000n,
    fixedBorrowPositions: [],
    penaltyRate: 0n,
    maxFuturePools: 13,
    floatingAssets: 1_902_895_825_956n,
    floatingDebt: 33_637_882_189n,
    floatingBackupBorrowed: 206_695_237_136n,
    interestRateModel: {
      parameters: {
        minRate: 5n * 10n ** 16n,
        naturalRate: 11n * 10n ** 16n,
        maxUtilization: 13n * 10n ** 17n,
        naturalUtilization: 88n * 10n ** 16n,
        growthSpeed: 13n * 10n ** 17n,
        sigmoidSpeed: 25n * 10n ** 17n,
        spreadFactor: 3n * 10n ** 17n,
        maturitySpeed: 5n * 10n ** 17n,
        timePreference: 2n * 10n ** 17n,
        fixedAllocation: 6n * 10n ** 17n,
        maxRate: 1825n * 10n ** 16n,
      },
    },
    fixedPools: [{ maturity: ONE_YEAR, borrowed: 87_821_599_306n, supplied: 30_000_000_000n }],
  };
  const weth = {
    ...usdc,
    market: parse(Address, marketWETHAddress),
    isCollateral: false,
    floatingDepositAssets: 0n,
  };
  const repay = (assets: bigint, { floatingAssets, floatingDebt, floatingBackupBorrowed, fixedPools } = usdc) => {
    const { borrowed, supplied } = fixedPools[0] ?? { borrowed: 0n, supplied: 0n };
    const backup = (total: bigint) => (total > supplied ? total - supplied : 0n);
    const rate = fixedRate(
      Number(ONE_YEAR),
      usdc.maxFuturePools,
      fixedUtilization(supplied, borrowed + assets, floatingAssets),
      floatingUtilization(floatingAssets, floatingDebt),
      globalUtilization(
        floatingAssets,
        floatingDebt,
        floatingBackupBorrowed + backup(borrowed + assets) - backup(borrowed),
      ),
      usdc.interestRateModel.parameters,
      0,
    );
    return assets + mulDivUp(assets, rate * ONE_YEAR, WAD * ONE_YEAR);
  };

  it("computes debit limit", () => {
    expect(limit([usdc], marketUSDCAddress, undefined, 0)).toBe(100_000_000n);
  });

  it("discounts fixed fee at the rate after the borrow from credit limit", () => {
    const credit = limit([weth, usdc], marketUSDCAddress, ONE_YEAR, 0) ?? 0n;

    expect(repay(credit)).toBeLessThanOrEqual(81_000_000n);
    expect(repay(credit + 1n)).toBeGreaterThan(81_000_000n);
  });

  it("solves credit limit when the borrow moves the rate", () => {
    const crowded = {
      ...usdc,
      floatingAssets: 150_000_000n,
      floatingDebt: 0n,
      floatingBackupBorrowed: 0n,
      fixedPools: [{ maturity: ONE_YEAR, borrowed: 0n, supplied: 0n }],
    };
    const credit = limit([crowded], marketUSDCAddress, ONE_YEAR, 0) ?? 0n;

    const estimate =
      (81_000_000n * WAD) /
      (WAD + fixedRate(Number(ONE_YEAR), usdc.maxFuturePools, 0n, 0n, 0n, usdc.interestRateModel.parameters, 0));

    expect(credit).toBeLessThan(estimate);
    expect(repay(estimate, crowded)).toBeGreaterThan(81_000_000n);
    expect(repay(credit, crowded)).toBeLessThanOrEqual(81_000_000n);
    expect(repay(credit + 1n, crowded)).toBeGreaterThan(81_000_000n);
  });

  it("solves credit limit when the borrow nearly drains the pool", () => {
    const shallow = {
      ...usdc,
      floatingAssets: 82_000_000n,
      floatingDebt: 0n,
      floatingBackupBorrowed: 0n,
      fixedPools: [{ maturity: ONE_YEAR, borrowed: 0n, supplied: 0n }],
    };
    const credit = limit([shallow], marketUSDCAddress, ONE_YEAR, 0) ?? 0n;

    expect(credit).toBeGreaterThan(0n);
    expect(repay(credit, shallow)).toBeLessThanOrEqual(81_000_000n);
    expect(repay(credit + 1n, shallow)).toBeGreaterThan(81_000_000n);
  });

  it("solves credit limit on an empty pool when the snapshot misses it", () => {
    const empty = { ...usdc, fixedPools: [{ maturity: BigInt(MATURITY_INTERVAL), borrowed: 0n, supplied: 0n }] };
    const credit = limit([usdc], marketUSDCAddress, BigInt(MATURITY_INTERVAL), 0) ?? 0n;

    expect(credit).toBe(limit([empty], marketUSDCAddress, BigInt(MATURITY_INTERVAL), 0));
    expect(credit).toBeLessThan(81_000_000n);
    expect(credit).toBeGreaterThan(0n);
  });

  it("computes zero credit limit past the last pool", () => {
    expect(limit([usdc], marketUSDCAddress, ONE_YEAR * 2n, 0)).toBe(0n);
    expect(limit([usdc], marketUSDCAddress, ONE_YEAR * 2n, Number(ONE_YEAR * 2n) - 1)).toBeGreaterThan(80_999_990n);
  });

  it("computes credit limit without fee at maturity", () => {
    expect(limit([usdc], marketUSDCAddress, ONE_YEAR, Number(ONE_YEAR))).toBe(81_000_000n);
  });

  it("reads serialized positions", () => {
    expect(limit(serialize([usdc]), marketUSDCAddress, undefined, 0)).toBe(100_000_000n);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("skips unknown positions", () => {
    expect(limit(undefined, marketUSDCAddress, undefined, 0)).toBeUndefined();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports unreadable positions", () => {
    expect(limit("bad", marketUSDCAddress, undefined, 0)).toBeUndefined();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(expect.any(SyntaxError), { level: "warning" });
  });

  it("reports missing market", () => {
    expect(limit([usdc], marketWETHAddress, undefined, 0)).toBeUndefined();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("market not found"), { level: "warning" });
  });
});
