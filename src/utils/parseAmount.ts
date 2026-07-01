import { parseUnits } from "viem";

export default function parseAmount(value: string | undefined, decimals = 6): bigint {
  if (!value) return 0n;
  const cleaned = value.replaceAll(/[^\d.,]/g, "");
  const normalized = cleaned.replaceAll(/[.,](?=.*[.,])/g, "").replace(",", ".");
  if (!normalized || normalized === ".") return 0n;
  try {
    return parseUnits(normalized, decimals);
  } catch {
    return 0n;
  }
}
