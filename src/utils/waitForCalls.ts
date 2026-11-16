import { waitForCallsStatus } from "@wagmi/core/actions";

import exa from "./wagmi/exa";

export default function waitForCalls(id: string) {
  return waitForCallsStatus(exa, { id }).catch(() => waitForCallsStatus(exa, { id, timeout: 10_000 }));
}
