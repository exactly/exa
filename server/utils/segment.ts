import { Analytics } from "@segment/analytics-node";
import { captureException } from "@sentry/node";

import type { Address } from "@exactly/common/validation";
import type { Prettify } from "viem";

let singleton: Analytics | undefined;

export default function segment(key: string) {
  const analytics = createAnalytics(key);
  return {
    close: () => analytics.closeAndFlush(),
    identify: (user: Parameters<typeof identify>[0]) => identify(user, analytics),
    track: (action: Parameters<typeof track>[0]) => track(action, analytics),
  };
}

export function identify(
  user: Prettify<Omit<Parameters<Analytics["identify"]>[0], "userId"> & { userId: Address }>,
  analytics = getAnalytics(),
) {
  analytics.identify(user);
}

type MerchantProperties = {
  category?: null | string;
  city?: null | string;
  country?: null | string;
  name: string;
};

type SourceProperty = { source: null | string };

export function track(
  action: Id<
    | { event: "AccountFunded"; properties: SourceProperty }
    | {
        event: "AuthorizationRejected";
        properties: SourceProperty & {
          cardMode: number;
          declinedReason: string;
          merchant: MerchantProperties;
          usdAmount: number;
        };
      }
    | { event: "CardDeleted"; properties: SourceProperty }
    | { event: "CardFrozen"; properties: SourceProperty }
    | { event: "CardIssued"; properties: SourceProperty & { productId: string } }
    | { event: "CardUnfrozen"; properties: SourceProperty }
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
          cardMode: number;
          merchant: MerchantProperties;
          type: "panda";
          usdAmount: number;
        };
      }
    | {
        event: "TransactionRefund";
        properties: SourceProperty & {
          id: string;
          merchant: MerchantProperties;
          type: "partial" | "refund" | "reversal";
          usdAmount: number;
        };
      }
    | {
        event: "TransactionRejected";
        properties: SourceProperty & {
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
  analytics = getAnalytics(),
) {
  try {
    analytics.track(action);
  } catch (error) {
    captureException(error, { level: "error" });
  }
}

export function closeAndFlush() {
  return singleton?.closeAndFlush() ?? Promise.resolve();
}

function getAnalytics() {
  if (singleton) return singleton;
  if (!process.env.SEGMENT_WRITE_KEY) throw new Error("missing segment write key");
  singleton = createAnalytics(process.env.SEGMENT_WRITE_KEY);
  return singleton;
}

function createAnalytics(key: string) {
  const analytics = new Analytics({ writeKey: key });
  analytics.on("error", (error) => captureException(error, { level: "error" }));
  return analytics;
}

type Id<T> = Prettify<T & { userId: Address }>;
