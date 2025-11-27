import { array, literal, object, optional, picklist, string, variant } from "valibot";
import { optimism, base, baseSepolia, optimismSepolia } from "viem/chains";

export const Currency = ["ARS", "USD", "CLP", "BRL", "COP", "PUSD", "CRC", "GTQ", "MXN", "PHP", "BOB", "EUR"] as const;
export const Cryptocurrency = ["USDC", "USDT", "ETH", "SOL", "BTC", "DAI", "PYUSD", "USDP"] as const; // cspell:ignore usdp
export const RampProvider = ["manteca", "bridge"] as const;

export const SupportedChainId = [optimism.id, base.id, baseSepolia.id, optimismSepolia.id] as const;

export const FiatNetwork = [
  "ARG_FIAT_TRANSFER",
  "STELLAR",
  "SOLANA",
  "SPEI", // cspell:ignore spei
  "TRON",
  "SEPA", // cspell:ignore sepa
  "WIRE",
  "ACH",
  "PIX",
] as const;

export const CryptoNetwork = ["TRON", "SOLANA", "STELLAR"] as const;

export type OnRampNetworkType = (typeof FiatNetwork)[number] | (typeof CryptoNetwork)[number];

export const ProviderStatus = ["NOT_STARTED", "ACTIVE", "ONBOARDING", "NOT_AVAILABLE", "MISSING_INFORMATION"] as const;

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
]);

export const QuoteResponse = optional(
  object({
    buyRate: string(),
    sellRate: string(),
  }),
);

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
    inquiryId: string(),
    sessionToken: string(),
    displayText: optional(string()),
    currencies: array(string()),
    cryptoCurrencies: array(object({ cryptoCurrency: string(), network: string() })),
  }),
]);

export const ProviderInfo = object({
  status: picklist(ProviderStatus),
  currencies: array(string()),
  cryptoCurrencies: array(object({ cryptoCurrency: picklist(Cryptocurrency), network: picklist(CryptoNetwork) })),
  pendingTasks: optional(array(PendingTask)),
});
