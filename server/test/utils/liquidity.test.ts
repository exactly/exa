import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { deserialize, serialize } from "@wagmi/core";
import { parse } from "valibot";
import { padHex } from "viem";
import { moonbeamDev } from "viem/chains";
import { describe, expect, it, vi } from "vitest";

import chain, { marketUSDCAddress, marketWETHAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { ONE_YEAR, WAD } from "@exactly/lib";

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
      [moonbeamDev.id]: serialize(remote),
    });
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

  it("skips accounts without card", async () => {
    const other = parse(Address, padHex("0x5678", { size: 20 }));
    await database
      .insert(credentials)
      .values({ id: "no-card", publicKey: new Uint8Array(), account: other, factory: other });
    const findFirst = vi.spyOn(database.query.credentials, "findFirst");

    refresh(database, redis, other, chain.id);

    await vi.waitFor(() => expect(findFirst).toHaveBeenCalledOnce());
    await expect(findFirst.mock.results[0]?.value).resolves.toStrictEqual({ pandaId: null });
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
    fixedPools: [{ maturity: ONE_YEAR, minBorrowRate: WAD / 10n }],
  };
  const weth = {
    ...usdc,
    market: parse(Address, marketWETHAddress),
    isCollateral: false,
    floatingDepositAssets: 0n,
    fixedPools: [{ maturity: ONE_YEAR, minBorrowRate: WAD }],
  };

  it("computes debit limit", () => {
    expect(limit([usdc], marketUSDCAddress, undefined, 0)).toBe(100_000_000n);
  });

  it("discounts estimated fixed fee from credit limit", () => {
    expect(limit([weth, usdc], marketUSDCAddress, ONE_YEAR, 0)).toBe(73_636_363n);
  });

  it("computes credit limit without fee when pool is unknown", () => {
    expect(limit([usdc], marketUSDCAddress, ONE_YEAR * 2n, 0)).toBe(81_000_000n);
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
