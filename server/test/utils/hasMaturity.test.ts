import { describe, expect, it } from "vitest";

import { MATURITY_INTERVAL } from "@exactly/lib";

import hasMaturity from "../../utils/hasMaturity";

describe("hasMaturity", () => {
  it("returns false for zero encoded value", () => {
    expect(hasMaturity(0n, 1_000_000)).toBe(false);
  });

  it("returns false when packed bitmap is zero", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (0n << 32n);
    expect(hasMaturity(encoded, baseMaturity)).toBe(false);
  });

  it("returns true when base maturity matches", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (1n << 32n);
    expect(hasMaturity(encoded, baseMaturity)).toBe(true);
  });

  it("returns true for offset maturities", () => {
    const baseMaturity = 1_000_000;
    const offset = 5;
    const targetMaturity = baseMaturity + offset * MATURITY_INTERVAL;
    const encoded = BigInt(baseMaturity) | (1n << BigInt(32 + offset));
    expect(hasMaturity(encoded, targetMaturity)).toBe(true);
  });

  it("returns false for out-of-range negative offset", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (1n << 32n);
    const targetMaturity = baseMaturity - MATURITY_INTERVAL;
    expect(hasMaturity(encoded, targetMaturity)).toBe(false);
  });

  it("returns false for out-of-range positive offset", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (1n << 32n);
    const targetMaturity = baseMaturity + 300 * MATURITY_INTERVAL;
    expect(hasMaturity(encoded, targetMaturity)).toBe(false);
  });

  it("returns false when bit is not set", () => {
    const baseMaturity = 1_000_000;
    const offset = 5;
    const encoded = BigInt(baseMaturity) | (1n << 32n);
    const targetMaturity = baseMaturity + offset * MATURITY_INTERVAL;
    expect(hasMaturity(encoded, targetMaturity)).toBe(false);
  });

  it("handles packed bitmaps with multiple bits set", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (0b101n << 32n);
    expect(hasMaturity(encoded, baseMaturity)).toBe(true);
    expect(hasMaturity(encoded, baseMaturity + MATURITY_INTERVAL)).toBe(false);
    expect(hasMaturity(encoded, baseMaturity + 2 * MATURITY_INTERVAL)).toBe(true);
  });

  it("returns false for non-aligned maturity (half interval offset)", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (0b11n << 32n);
    const targetMaturity = baseMaturity + MATURITY_INTERVAL / 2;
    expect(hasMaturity(encoded, targetMaturity)).toBe(false);
  });

  it("returns false for maturity offset by one second", () => {
    const baseMaturity = 1_000_000;
    const encoded = BigInt(baseMaturity) | (1n << 32n);
    expect(hasMaturity(encoded, baseMaturity + 1)).toBe(false);
  });

  it("handles maximum valid offset", () => {
    const baseMaturity = 1_000_000;
    const offset = 223;
    const targetMaturity = baseMaturity + offset * MATURITY_INTERVAL;
    const encoded = BigInt(baseMaturity) | (1n << BigInt(32 + offset));
    expect(hasMaturity(encoded, targetMaturity)).toBe(true);
  });
});
