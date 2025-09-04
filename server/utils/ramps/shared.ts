import * as v from "valibot";

export const Currency = ["ARS", "USD", "CLP", "BRL", "COP", "PUSD", "CRC", "GTQ", "MXN", "PHP", "BOB"] as const;
export const RampProvider = ["manteca"] as const;

export const OnRampNetwork = ["ARG_FIAT_TRANSFER", "PIX"] as const;
export type OnRampNetworkType = (typeof OnRampNetwork)[number];

export const DepositDetails = v.variant("network", [
  v.object({
    network: v.literal("ARG_FIAT_TRANSFER" satisfies OnRampNetworkType),
    depositAlias: v.optional(v.string()),
    depositAddress: v.string(),
    displayName: v.picklist(["CBU", "CVU"]),
    beneficiaryName: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
  v.object({
    network: v.literal("PIX" satisfies OnRampNetworkType),
    depositAddress: v.string(),
    displayName: v.literal("PIX KEY"),
    beneficiaryName: v.string(),
    fee: v.string(),
    estimatedProcessingTime: v.string(),
  }),
]);
