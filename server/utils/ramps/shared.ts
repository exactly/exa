import * as v from "valibot";
import { optimism, base, baseSepolia, optimismSepolia } from "viem/chains";

export const Currency = ["ARS", "USD", "CLP", "BRL", "COP", "PUSD", "CRC", "GTQ", "MXN", "PHP", "BOB", "EUR"] as const;
export const Cryptocurrency = ["USDC", "USDT", "ETH", "SOL", "BTC", "DAI", "PYUSD", "USDP"] as const; // cspell:ignore usdp
export const RampProvider = ["manteca", "bridge"] as const;

export const SupportedChainId = [optimism.id, base.id, baseSepolia.id, optimismSepolia.id] as const;

export const FiatNetwork = [
  "ARG_FIAT_TRANSFER",
  "STELLAR",
  "SOLANA",
  "SPEI",
  "TRON",
  "SEPA",
  "WIRE",
  "ACH",
  "PIX",
] as const; // cspell:ignore spei, sepa

export const CryptoNetwork = ["TRON", "SOLANA", "STELLAR"] as const;

export type OnRampNetworkType = (typeof FiatNetwork)[number] | (typeof CryptoNetwork)[number];

export const ProviderStatus = ["NOT_STARTED", "ACTIVE", "ONBOARDING", "NOT_AVAILABLE", "MISSING_INFORMATION"] as const;

export const DepositDetails = v.variant("network", [
  v.object({
    network: v.literal("ARG_FIAT_TRANSFER" satisfies OnRampNetworkType),
    depositAlias: v.optional(v.string()),
    cbu: v.string(),
    displayName: v.picklist(["CBU", "CVU"]),
    beneficiaryName: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("PIX" satisfies OnRampNetworkType),
    pixKey: v.string(),
    displayName: v.literal("PIX KEY"),
    beneficiaryName: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("ACH" satisfies OnRampNetworkType),
    displayName: v.literal("ACH"),
    beneficiaryName: v.string(),
    routingNumber: v.string(),
    accountNumber: v.string(),
    bankName: v.string(),
    bankAddress: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("WIRE" satisfies OnRampNetworkType),
    displayName: v.literal("WIRE"),
    beneficiaryName: v.string(),
    routingNumber: v.string(),
    accountNumber: v.string(),
    bankAddress: v.string(),
    bankName: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("SEPA" satisfies OnRampNetworkType),
    displayName: v.literal("SEPA"),
    beneficiaryName: v.string(),
    iban: v.string(), // cspell:ignore iban
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("SPEI" satisfies OnRampNetworkType),
    displayName: v.literal("SPEI"),
    beneficiaryName: v.string(),
    clabe: v.string(), // cspell:ignore clabe
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("TRON" satisfies OnRampNetworkType),
    displayName: v.literal("TRON"),
    address: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("SOLANA" satisfies OnRampNetworkType),
    displayName: v.literal("SOLANA"),
    address: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("STELLAR" satisfies OnRampNetworkType),
    displayName: v.literal("STELLAR"),
    address: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
]);

export const QuoteResponse = v.optional(
  v.object({
    buyRate: v.string(),
    sellRate: v.string(),
  }),
);

export const PendingTask = v.variant("type", [
  v.object({
    type: v.literal("TOS_LINK"),
    link: v.string(),
    displayText: v.optional(v.string()),
    currencies: v.array(v.string()),
    cryptoCurrencies: v.array(
      v.object({
        cryptoCurrency: v.string(),
        network: v.string(),
      }),
    ),
  }),
  v.object({
    type: v.literal("INQUIRY"),
    link: v.string(),
    displayText: v.optional(v.string()),
    currencies: v.array(v.string()),
    cryptoCurrencies: v.array(
      v.object({
        cryptoCurrency: v.string(),
        network: v.string(),
      }),
    ),
  }),
]);

export const ProviderInfo = v.object({
  status: v.picklist(ProviderStatus),
  currencies: v.array(v.string()),
  cryptoCurrencies: v.array(
    v.object({
      cryptoCurrency: v.picklist(Cryptocurrency),
      network: v.picklist(CryptoNetwork),
    }),
  ),
  pendingTasks: v.optional(v.array(PendingTask)),
});
