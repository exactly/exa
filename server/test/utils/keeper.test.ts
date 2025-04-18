import "../mocks/sentry";
import "../mocks/deployments";
import "../mocks/keeper";

import { describe, expect, inject, it, vi } from "vitest";

import { auditorAbi } from "../../generated/contracts";
import keeper from "../../utils/keeper";
import publicClient from "../../utils/publicClient";

describe("fault tolerance", () => {
  it("recovers if transaction is missing", async () => {
    const sendRawTransaction = vi.spyOn(publicClient, "sendRawTransaction");
    sendRawTransaction.mockResolvedValueOnce("0x");
    const onHash = vi.fn<() => void>();
    const receipt = await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash },
    );

    expect(onHash).toHaveBeenCalledOnce();
    expect(receipt?.status).toBe("success");
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });
});
