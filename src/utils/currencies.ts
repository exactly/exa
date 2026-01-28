import { picklist, safeParse } from "valibot";

export const currencyMap = {
  ARS: { name: "Argentinian Pesos", emoji: "🇦🇷" },
  BRL: { name: "Brazilian Real", emoji: "🇧🇷" },
  USD: { name: "US Dollars", emoji: "🇺🇸" },
} as const;

export type Currency = keyof typeof currencyMap;

export const CurrencySchema = picklist(Object.keys(currencyMap) as [Currency, ...Currency[]]);

export function isValidCurrency(value: unknown): value is Currency {
  return safeParse(CurrencySchema, value).success;
}
