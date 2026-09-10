import { formatUnits } from "viem";

export default function formatTokenAmount(amount: bigint, decimals: number, language: string) {
  const value = Number(formatUnits(amount, decimals));
  if (value === 0) return "0";
  return value.toLocaleString(language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: Math.min(8, Math.max(0, decimals - Math.ceil(Math.log10(value)))),
  });
}
