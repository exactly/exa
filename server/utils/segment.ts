import { Analytics } from "@segment/analytics-node";
import { captureException } from "@sentry/node";

import type { Address } from "@exactly/common/validation";
import type { Prettify } from "viem";

export default function segment(key: string) {
  const analytics = new Analytics({ writeKey: key });
  analytics.on("error", (error) => captureException(error, { level: "error" }));
  return { close, identify, track };

  function close() {
    return analytics.closeAndFlush();
  }

  function identify(user: Prettify<Omit<Parameters<Analytics["identify"]>[0], "userId"> & { userId: Address }>) {
    analytics.identify(user);
  }

  function track(
    action: Id<
      | { event: "AccountFunded"; properties: SourceProperty }
      | {
          event: "AuthorizationRejected";
          properties: SourceProperty & {
            cardId: string;
            cardMode: number;
            declinedReason: string;
            merchant: MerchantProperties;
            usdAmount: number;
          };
        }
      | { event: "CardDeleted"; properties: SourceProperty & { cardId: string } }
      | { event: "CardFrozen"; properties: SourceProperty & { cardId: string } }
      | { event: "CardIssued"; properties: SourceProperty & { cardId: string; productId: string } }
      | { event: "CardUnfrozen"; properties: SourceProperty & { cardId: string } }
      | {
          event: "Offramp";
          properties: {
            amount: number;
            currency: string;
            provider: "bridge" | "manteca";
            source: null | string;
            usdcAmount: number;
          };
        }
      | {
          event: "Onramp";
          properties: {
            amount: number;
            currency: string;
            provider: "bridge" | "manteca";
            source: null | string;
            usdcAmount: number;
          };
        }
      | {
          event: "PandaCollectionFailed";
          properties: {
            action: "completed" | "created" | "updated";
            amount: number;
            authorizedAmount?: null | number;
            cardId: string;
            cardMode: number;
            functionName: string;
            id: string;
            knownTransaction: boolean;
            merchant: MerchantProperties;
            reason: string;
            reasonName: string;
            settlement: boolean;
            source: null | string;
            usdAmount: number;
            webhookId: string;
          };
        }
      | { event: "RampAccount"; properties: { provider: "bridge" | "manteca"; source: null | string } }
      | {
          event: "TransactionAuthorized";
          properties: SourceProperty & {
            cardId: string;
            cardMode: number;
            merchant: MerchantProperties;
            type: "panda";
            usdAmount: number;
          };
        }
      | {
          event: "TransactionRefund";
          properties: SourceProperty & {
            cardId: string;
            id: string;
            merchant: MerchantProperties;
            type: "partial" | "refund" | "reversal";
            usdAmount: number;
          };
        }
      | {
          event: "TransactionRejected";
          properties: SourceProperty & {
            cardId: string;
            cardMode: number;
            declinedReason?: null | string;
            id: string;
            merchant: MerchantProperties;
            reasonName?: null | string;
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
}

type MerchantProperties = {
  category?: null | string;
  city?: null | string;
  country?: null | string;
  name: string;
};

type SourceProperty = { source: null | string };

type Id<T> = Prettify<T & { userId: Address }>;
