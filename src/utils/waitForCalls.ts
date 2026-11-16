import { waitForCallsStatus } from "@wagmi/core/actions";

import type { Config } from "@wagmi/core";

export default function waitForCalls(config: Config, id: string) {
  return waitForCallsStatus(config, { id }).catch(() => waitForCallsStatus(config, { id, timeout: 10_000 }));
}
