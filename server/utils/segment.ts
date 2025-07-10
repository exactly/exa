import type { Address } from "@exactly/common/validation";
import { Analytics } from "@segment/analytics-node";
import { captureException } from "@sentry/node";
import type { Prettify } from "viem";

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
    | { event: "CardIssued" }
    | { event: "CardFrozen" }
    | { event: "CardUnfrozen" }
    | {
        event: "TransactionAuthorized";
        properties: {
          type: "panda";
          usdAmount: number;
          merchant: MerchantProperties;
        };
      }
    | {
        event: "TransactionRefund";
        properties: {
          id: string;
          type: "reversal" | "refund" | "partial";
          usdAmount: number;
          merchant: MerchantProperties;
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
