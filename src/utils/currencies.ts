import { picklist, safeParse } from "valibot";

export const currencies = {
  ARS: { name: "Argentine Pesos", shortName: "Pesos", emoji: "🇦🇷" },
  BRL: { name: "Brazilian Real", shortName: "Reals", emoji: "🇧🇷" },
  EUR: { name: "Euros", shortName: "Euros", emoji: "🇪🇺" },
  GBP: { name: "British Pounds", shortName: "Pounds", emoji: "🇬🇧" },
  MXN: { name: "Mexican Pesos", shortName: "Pesos", emoji: "🇲🇽" },
  USD: { name: "US Dollars", shortName: "Dollars", emoji: "🇺🇸" },
} as const;

export const bridgeMethods: Partial<Record<Currency, string>> = {
  USD: "ACH or WIRE",
  EUR: "SEPA",
  GBP: "FPS",
  MXN: "SPEI",
  BRL: "PIX",
};

export type Currency = keyof typeof currencies;

export const CurrencySchema = picklist(Object.keys(currencies) as [Currency, ...Currency[]]);

export function isValidCurrency(value: unknown): value is Currency {
  return safeParse(CurrencySchema, value).success;
}

export const fees = {
  manteca: {
    transfer: {
      fee: "0%-2%",
    },
  },
  bridge: {
    ACH: {
      fee: "$0.5 + 0.2%",
      creation: "$1",
      maintenance: "$2",
    },
    WIRE: {
      fee: "$10",
      creation: "$1",
      maintenance: "$2",
    },
    SEPA: {
      // cspell:ignore sepa
      fee: "0.35% + mid-market rate",
      creation: "$2",
      maintenance: "$2",
    },

    SPEI: {
      // cspell:ignore spei
      fee: "0.5% + mid-market rate",
      creation: "~$1.5 (30 MXN)",
      maintenance: "~$1.5 (30 MXN)",
    },
    FPS: {
      fee: "0.5% + mid-market rate",
      creation: "~$2 (1.5 GBP)",
      maintenance: "~$2 (1.5 GBP)",
    },
  },
};
