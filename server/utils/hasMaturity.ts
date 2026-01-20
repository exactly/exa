import { MATURITY_INTERVAL } from "@exactly/lib";

const MASK_BASE_MATURITY = (1n << 32n) - 1n;

export default function hasMaturity(encoded: bigint, maturity: number): boolean {
  if (encoded === 0n) return false;

  const baseMaturity = encoded & MASK_BASE_MATURITY;
  const packed = encoded >> 32n;

  if (packed === 0n) return false;

  const offset = (maturity - Number(baseMaturity)) / MATURITY_INTERVAL;
  if (!Number.isInteger(offset) || offset < 0 || offset > 223) return false;

  return (packed & (1n << BigInt(offset))) !== 0n;
}
