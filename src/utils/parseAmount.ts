import { parseUnits } from "viem";

export default function parseAmount(value: string | undefined, decimals = 6): bigint {
  if (!value) return 0n;
  try {
    return parseUnits(value, decimals);
  } catch {
    return 0n;
  }
}
