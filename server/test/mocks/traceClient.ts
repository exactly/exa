import { zeroAddress, type Hash } from "viem";
import { afterEach, vi } from "vitest";

import type * as traceClient from "../../utils/traceClient";

let tracing = false;

vi.mock("../../utils/traceClient", async (importOriginal) => {
  const original = await importOriginal<typeof traceClient>();
  return {
    ...original,
    trace: (...parameters: Parameters<typeof original.trace>) => {
      const actions = original.trace(...parameters);
      return { ...actions, traceTransaction: suppress(actions.traceTransaction) };
    },
    default: {
      ...original.default,
      traceTransaction: suppress((hash) => original.default.traceTransaction(hash)),
    },
  };
});

// eslint-disable-next-line import/prefer-default-export -- mirrors mocked module
export function enableTracing() {
  tracing = true;
}

afterEach(() => {
  tracing = false;
});

function suppress(traceTransaction: (hash: Hash) => Promise<traceClient.CallFrame>) {
  return (hash: Hash) => (tracing ? traceTransaction(hash) : Promise.resolve(emptyTrace));
}

const emptyTrace = {
  from: zeroAddress,
  gas: "0x0",
  gasUsed: "0x0",
  input: "0x",
  output: "0x",
  to: zeroAddress,
  type: "CALL",
} satisfies traceClient.CallFrame;
