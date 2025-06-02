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

export function track(
  action: Id<
    | { event: "CardIssued" }
    | { event: "CardFrozen" }
    | { event: "CardUnfrozen" }
    | { event: "TransactionAuthorized"; properties: { type: "cryptomate" | "panda"; usdAmount: number } }
    | {
        event: "TransactionRefund";
        properties: { id: string; type: "reversal" | "refund" | "partial"; usdAmount: number };
      }
  >,
) {
  analytics.track(action);
}

export function closeAndFlush() {
  return analytics.closeAndFlush();
}

analytics.on("error", (error) => captureException(error, { level: "error" }));

type Id<T> = Prettify<{ userId: Address } & T>;
