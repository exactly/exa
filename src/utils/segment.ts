import { Platform } from "react-native";

import domain from "@exactly/common/domain";

import e2e from "./e2e";
import reportError from "./reportError";

import type { Address } from "@exactly/common/validation";
import type * as Segment from "@segment/analytics-next";

const writeKey =
  process.env.EXPO_PUBLIC_SEGMENT_WRITE_KEY || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  {
    "web.exactly.app": "FJTw4i9mgeV6Uh6iQMHsfnYN1TZ3qcha", // cspell:ignore hsfn qcha
    "base.exactly.app": "kic65cfve7aRYSJFEG3vXwpEVc1hd4k4", // cspell:ignore cfve rysjfeg
    "sandbox.exactly.app": "2KvNXndq43wKjJGtx62EUKQdIHbpUO11", // cspell:ignore xndq
    "base-sepolia.exactly.app": "AE0yTggpNTkI2l767HfMe2ltMdyJnMgu", // cspell:ignore tggp
  }[domain];

const analytics =
  Platform.OS === "web" && writeKey && !e2e && typeof window !== "undefined"
    ? (() => {
        const { AnalyticsBrowser } = require("@segment/analytics-next") as typeof Segment; // eslint-disable-line unicorn/prefer-module
        return AnalyticsBrowser.load({ writeKey });
      })()
    : undefined;

export function identify(userId: Address) {
  analytics?.identify(userId).catch(reportError);
}

export function page() {
  analytics?.page().catch(reportError);
}

export function reset() {
  analytics?.reset().catch(reportError);
}

export function track({ event, properties }: Action) {
  analytics?.track(event, properties).catch(reportError);
}

type Action = { event: "CtaPressed"; properties: { name: string } };
