import { array, literal, object, optional, picklist, string, variant } from "valibot";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

export const Currency = [
  "ARS",
  "BOB",
  "BRL",
  "CLP",
  "COP",
  "CRC",
  "EUR",
  "GBP",
  "GTQ",
  "MXN",
  "PHP",
  "PUSD",
  "USD",
] as const;
export const Cryptocurrency = ["BTC", "DAI", "ETH", "PYUSD", "SOL", "USDC", "USDP", "USDT"] as const; // cspell:ignore usdp
export const RampProvider = ["bridge", "manteca"] as const;

export const SupportedChainId = [optimism.id, base.id, baseSepolia.id, optimismSepolia.id] as const;
export const DevelopmentChainIds = [baseSepolia.id, optimismSepolia.id] as const;

export const FiatNetwork = [
  "ACH",
  "ARG_FIAT_TRANSFER",
  "FASTER_PAYMENTS",
  "PIX",
  "SEPA", // cspell:ignore sepa
  "SOLANA",
  "SPEI", // cspell:ignore spei
  "STELLAR",
  "TRON",
  "WIRE",
] as const;

export const CryptoNetwork = ["SOLANA", "STELLAR", "TRON"] as const;

export type OnRampNetworkType = (typeof CryptoNetwork)[number] | (typeof FiatNetwork)[number];

export const DepositDetails = variant("network", [
  object({
    network: literal("ARG_FIAT_TRANSFER" satisfies OnRampNetworkType),
    depositAlias: optional(string()),
    cbu: string(),
    displayName: picklist(["CBU", "CVU"]),
    beneficiaryName: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("PIX" satisfies OnRampNetworkType),
    pixKey: string(),
    displayName: literal("PIX KEY"),
    beneficiaryName: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("ACH" satisfies OnRampNetworkType),
    displayName: literal("ACH"),
    beneficiaryName: string(),
    routingNumber: string(),
    accountNumber: string(),
    bankName: string(),
    bankAddress: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("WIRE" satisfies OnRampNetworkType),
    displayName: literal("WIRE"),
    beneficiaryName: string(),
    routingNumber: string(),
    accountNumber: string(),
    bankAddress: string(),
    bankName: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("SEPA" satisfies OnRampNetworkType),
    displayName: literal("SEPA"),
    beneficiaryName: string(),
    iban: string(), // cspell:ignore iban
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("SPEI" satisfies OnRampNetworkType),
    displayName: literal("SPEI"),
    beneficiaryName: string(),
    clabe: string(), // cspell:ignore clabe
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("TRON" satisfies OnRampNetworkType),
    displayName: literal("TRON"),
    address: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("SOLANA" satisfies OnRampNetworkType),
    displayName: literal("SOLANA"),
    address: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("STELLAR" satisfies OnRampNetworkType),
    displayName: literal("STELLAR"),
    address: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
  object({
    network: literal("FASTER_PAYMENTS" satisfies OnRampNetworkType),
    displayName: literal("Faster Payments"),
    accountNumber: string(),
    sortCode: string(),
    accountHolderName: string(),
    bankName: string(),
    bankAddress: string(),
    fee: string(),
    estimatedProcessingTime: string(),
  }),
]);

export const QuoteResponse = optional(object({ buyRate: string(), sellRate: string() }));

export const PendingTask = variant("type", [
  object({
    type: literal("TOS_LINK"),
    link: string(),
    displayText: optional(string()),
    currencies: array(string()),
    cryptoCurrencies: array(object({ cryptoCurrency: string(), network: string() })),
  }),
  object({
    type: literal("INQUIRY"),
    link: string(),
    displayText: optional(string()),
    currencies: array(string()),
    cryptoCurrencies: array(object({ cryptoCurrency: string(), network: string() })),
  }),
]);

export const ProviderInfo = object({
  onramp: object({
    currencies: array(string()),
    limits: optional(
      object({
        monthly: optional(
          object({
            available: optional(string()),
            limit: optional(string()),
            symbol: string(),
          }),
        ),
        yearly: optional(
          object({
            available: optional(string()),
            limit: optional(string()),
            symbol: string(),
          }),
        ),
      }),
    ),
    cryptoCurrencies: array(object({ cryptoCurrency: picklist(Cryptocurrency), network: picklist(CryptoNetwork) })),
  }),
  status: picklist(["ACTIVE", "NOT_AVAILABLE", "NOT_STARTED", "ONBOARDING"]),
  tosLink: optional(string()),
});
