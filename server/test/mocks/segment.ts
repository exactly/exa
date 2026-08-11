import { Analytics } from "@segment/analytics-node";
import { vi } from "vitest";

import type * as Segment from "../../utils/segment";

vi.mock("../../utils/segment", async (importOriginal) => {
  const segment = await importOriginal<typeof Segment>();
  const module = { ...segment };
  return Object.assign(module, {
    default: (key: string) => {
      const analytics = new Analytics({ writeKey: key });
      return {
        close: () => analytics.closeAndFlush(),
        identify: (user: Parameters<typeof segment.identify>[0]) => module.identify(user, analytics),
        track: (action: Parameters<typeof segment.track>[0]) => module.track(action, analytics),
      };
    },
  });
});
