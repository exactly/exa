import type { Address } from "@exactly/common/validation";
import { Analytics } from "@segment/analytics-node";
import { captureException } from "@sentry/node";
import type { Prettify } from "viem";

import type { CardType } from "./getCardType";

if (!process.env.SEGMENT_WRITE_KEY) throw new Error("missing segment write key");

const analytics = new Analytics({ writeKey: process.env.SEGMENT_WRITE_KEY });

export function identify(
  user: Prettify<{ userId: Address } & Omit<Parameters<typeof analytics.identify>[0], "userId">>,
) {
  analytics.identify(user);
}

interface MerchantProperties {
  category?: string | null;
  name: string;
  city?: string | null;
  country?: string | null;
}

export function track(
  action: Id<
    | {
        event: "CardIssued";
        properties: { productId: string; source: string; cardType: CardType };
      }
    | {
        event: "CardFrozen";
        properties: { source: string; cardType: CardType };
      }
    | {
        event: "CardUnfrozen";
        properties: { source: string; cardType: CardType };
      }
    | { event: "CardDeleted"; properties: { source: string; cardType: CardType } }
    | { event: "AccountFunded" }
    | {
        event: "TransactionAuthorized";
        properties: {
          type: "panda";
          cardMode: number;
          usdAmount: number;
          merchant: MerchantProperties;
          source: string;
          cardType: CardType;
        };
      }
    | {
        event: "TransactionRefund";
        properties: {
          id: string;
          type: "reversal" | "refund" | "partial";
          usdAmount: number;
          merchant: MerchantProperties;
          source: string;
          cardType: CardType;
        };
      }
    | {
        event: "TransactionRejected";
        properties: {
          id: string;
          cardMode: number;
          usdAmount: number;
          merchant: MerchantProperties;
          updated: boolean;
          declinedReason?: string | null;
          source: string;
          cardType: CardType;
        };
      }
    | {
        event: "AuthorizationRejected";
        properties: {
          cardMode: number;
          usdAmount: number;
          merchant: MerchantProperties;
          declinedReason: string;
          source: string;
          cardType: CardType;
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

type Id<T> = Prettify<{ userId: Address } & T>;
