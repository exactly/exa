import "../mocks/sentry";
import "../mocks/deployments";
import "../mocks/keeper";
import { onFetchResponse } from "../mocks/publicClient"; // eslint-disable-line import/order -- must be imported early

import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import { auditorAbi } from "../../generated/contracts";
import keeper from "../../utils/keeper";
import publicClient from "../../utils/publicClient";

const OriginalDate = Date;
// @ts-expect-error -- development
global.OriginalDate = OriginalDate;

describe("fault tolerance", () => {
  beforeEach(() => vi.useFakeTimers());

  afterEach(() => {
    vi.useRealTimers();
    onFetchResponse.mockReset();
  });

  it("recovers if transaction is missing", { timeout: 10_000 }, async () => {
    const originalSendRawTransaction = publicClient.sendRawTransaction;
    const sendRawTransaction = vi.spyOn(publicClient, "sendRawTransaction");
    sendRawTransaction.mockResolvedValueOnce("0x");
    onFetchResponse.mockImplementation(async (response) => {
      console.log("on fetch response", response.status);
      await vi.advanceTimersByTimeAsync(0);
    });
    const onHash = vi.fn<() => Promise<void>>(async () => {
      console.log(new OriginalDate().toISOString(), new Date().toISOString(), "on hash");
      await vi.advanceTimersByTimeAsync(0);
      sendRawTransaction.mockImplementationOnce(async (...arguments_) => {
        console.log(new OriginalDate().toISOString(), new Date().toISOString(), "send mock");
        const promise = originalSendRawTransaction.apply(publicClient, arguments_);
        await vi.advanceTimersByTimeAsync(0);
        return promise;
      });
    });
    console.log(new OriginalDate().toISOString(), new Date().toISOString(), "before send");
    const send = keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash },
    );
    console.log(new OriginalDate().toISOString(), new Date().toISOString(), "after send");
    await vi.advanceTimersByTimeAsync(0);
    console.log(new OriginalDate().toISOString(), new Date().toISOString(), "after send timer");
    const receipt = await send;
    console.log(new OriginalDate().toISOString(), new Date().toISOString(), "after receipt");

    expect(onHash).toHaveBeenCalledOnce();
    expect(receipt?.status).toBe("success");
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });
});
