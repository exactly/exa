import { picklist, safeParse } from "valibot";

export const currencies = {
  ARS: { name: "Argentine Pesos", emoji: "🇦🇷" },
  BRL: { name: "Brazilian Real", emoji: "🇧🇷" },
  USD: { name: "US Dollars", emoji: "🇺🇸" },
} as const;

export type Currency = keyof typeof currencies;

export const CurrencySchema = picklist(Object.keys(currencies) as [Currency, ...Currency[]]);

export function isValidCurrency(value: unknown): value is Currency {
  return safeParse(CurrencySchema, value).success;
}
