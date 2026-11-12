import { describe, expect, it } from "vitest";

import stableMessage from "@exactly/common/stableMessage";

describe("stable message", () => {
  it.each([
    ["request 3f2a9c1e-77b1-4c2d-9e0f-1A2B3C4D5E6F failed", "request <id> failed"],
    ["trace-id: 338295e5b960f89e490e5c2b17cf822c", "trace-id: <id>"],
    ["tx 0x4f3c8a5b9d2e1f7a6c0b8d9e3f2a1b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a reverted", "tx <id> reverted"],
    ["first line\nURL: https://rpc.test\nRequest body: {}", "first line"],
    ["AA23 reverted at block 123 with 0x1234", "AA23 reverted at block 123 with 0x1234"],
  ])("keeps %s stable", (message, stable) => {
    expect(stableMessage(message)).toBe(stable);
  });
});
