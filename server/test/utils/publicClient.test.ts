import "../mocks/sentry";
import "../mocks/deployments";

import { describe, expect, inject, it } from "vitest";

import { auditorAbi } from "../../generated/contracts";
import publicClient from "../../utils/publicClient";

describe("fault tolerance", () => {
  it("recovers from http error", async () => {
    const { request } = await publicClient.simulateContract({
      address: inject("Auditor"),
      abi: auditorAbi,
      functionName: "enterMarket",
      args: [inject("MarketUSDC")],
    });

    expect(request).toBeDefined();
  });
});
