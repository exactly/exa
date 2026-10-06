import { Platform } from "react-native";

import domain from "@exactly/common/domain";

import e2e from "./e2e";
import reportError from "./reportError";

import type { Address } from "@exactly/common/validation";
import type * as Segment from "@segment/analytics-next";
import type * as SegmentNative from "@segment/analytics-react-native";
import type * as FacebookAppEvents from "@segment/analytics-react-native-plugin-facebook-app-events";

const writeKey =
  process.env.EXPO_PUBLIC_SEGMENT_WRITE_KEY || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  (Platform.OS === "web"
    ? {
        "web.exactly.app": "FJTw4i9mgeV6Uh6iQMHsfnYN1TZ3qcha", // cspell:ignore hsfn qcha
        "base.exactly.app": "kic65cfve7aRYSJFEG3vXwpEVc1hd4k4", // cspell:ignore cfve rysjfeg
        "sandbox.exactly.app": "2KvNXndq43wKjJGtx62EUKQdIHbpUO11", // cspell:ignore xndq
        "base-sepolia.exactly.app": "AE0yTggpNTkI2l767HfMe2ltMdyJnMgu", // cspell:ignore tggp
      }[domain]
    : {
        "web.exactly.app": undefined, // TODO add react native source write key
        "sandbox.exactly.app": undefined, // TODO add react native source write key
      }[domain]);

const analytics =
  writeKey && !e2e
    ? Platform.OS === "web"
      ? typeof window === "undefined"
        ? undefined
        : (() => {
            const { AnalyticsBrowser } = require("@segment/analytics-next") as typeof Segment; // eslint-disable-line unicorn/prefer-module
            return AnalyticsBrowser.load({ writeKey });
          })()
      : (() => {
          const { createClient } = require("@segment/analytics-react-native") as typeof SegmentNative; // eslint-disable-line unicorn/prefer-module
          const { FacebookAppEventsPlugin } =
            require("@segment/analytics-react-native-plugin-facebook-app-events") as typeof FacebookAppEvents; // eslint-disable-line unicorn/prefer-module
          const client = createClient({ writeKey, trackAppLifecycleEvents: true });
          client.add({ plugin: new FacebookAppEventsPlugin() });
          return client;
        })()
    : undefined;

export function identify(userId: Address) {
  analytics?.identify(userId).catch(reportError);
}

export function page(name: string) {
  if (!analytics) return;
  ("page" in analytics ? analytics.page() : analytics.screen(name)).catch(reportError);
}

export function reset() {
  analytics?.reset().catch(reportError);
}
