import { parse } from "valibot";
import { onTestFinished, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import { subscribe, type Kind } from "../utils/events";

export default function listen(account: string) {
  const listener = vi.fn<(kind: Kind) => void>();
  const unsubscribe = subscribe(parse(Address, account), listener, () => undefined);
  if (unsubscribe) onTestFinished(unsubscribe);
  return listener;
}
