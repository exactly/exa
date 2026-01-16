import { Analytics } from "@segment/analytics-node";
import { captureException } from "@sentry/node";

import type { Address } from "@exactly/common/validation";
import type { Prettify } from "viem";

if (!process.env.SEGMENT_WRITE_KEY) throw new Error("missing segment write key");

const analytics = new Analytics({ writeKey: process.env.SEGMENT_WRITE_KEY });

export function identify(
  user: Prettify<Omit<Parameters<typeof analytics.identify>[0], "userId"> & { userId: Address }>,
) {
  analytics.identify(user);
}

type MerchantProperties = {
  category?: null | string;
  city?: null | string;
  country?: null | string;
  name: string;
};

export function track(
  action: Id<
    | { event: "AccountFunded" }
    | {
        event: "AuthorizationRejected";
        properties: {
          cardMode: number;
          declinedReason: string;
          merchant: MerchantProperties;
          usdAmount: number;
        };
      }
    | { event: "CardDeleted" }
    | { event: "CardFrozen" }
    | { event: "CardIssued"; properties: { productId: string } }
    | { event: "CardUnfrozen" }
    | {
        event: "TransactionAuthorized";
        properties: {
          cardMode: number;
          merchant: MerchantProperties;
          type: "panda";
          usdAmount: number;
        };
      }
    | {
        event: "TransactionRefund";
        properties: {
          id: string;
          merchant: MerchantProperties;
          type: "partial" | "refund" | "reversal";
          usdAmount: number;
        };
      }
    | {
        event: "TransactionRejected";
        properties: {
          cardMode: number;
          declinedReason?: null | string;
          id: string;
          merchant: MerchantProperties;
          updated: boolean;
          usdAmount: number;
        };
      }
  >,
) {
  try {
    analytics.track(action);
  } catch (error) {
    captureException(error, { level: "error" });
  }
}

export function closeAndFlush() {
  return analytics.closeAndFlush();
}

analytics.on("error", (error) => captureException(error, { level: "error" }));

type Id<T> = Prettify<T & { userId: Address }>;
