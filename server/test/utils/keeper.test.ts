import "../mocks/sentry";
import "../mocks/deployments";
import "../mocks/keeper";

import { captureException } from "@sentry/node";
import type * as timers from "node:timers/promises";
import { afterEach, describe, expect, inject, it, vi } from "vitest";

import { auditorAbi } from "../../generated/contracts";
import keeper from "../../utils/keeper";
import publicClient from "../../utils/publicClient";

describe("fault tolerance", () => {
  it("recovers if transaction is missing", async () => {
    const sendRawTransaction = vi.spyOn(publicClient, "sendRawTransaction");
    sendRawTransaction.mockRejectedValueOnce(new Error("send"));
    const onHash = vi.fn<() => void>();
    const receipt = await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash },
    );

    expect(captureException).toHaveBeenCalledWith(new Error("send"), expect.objectContaining({ level: "error" }));
    expect(onHash).toHaveBeenCalledOnce();
    expect(receipt?.status).toBe("success");
    expect(sendRawTransaction).toHaveBeenCalledTimes(2);
  });

  it("times out if can't send transaction", async () => {
    const waitForTransactionReceipt = publicClient.waitForTransactionReceipt;
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
      waitForTransactionReceipt({ ...parameters, timeout: 1100 }),
    );
    const sendRawTransaction = vi.spyOn(publicClient, "sendRawTransaction");
    sendRawTransaction.mockResolvedValue("0x");
    const onHash = vi.fn<() => void>();

    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { onHash },
      ),
    ).rejects.toThrow("Timed out while waiting for transaction");
    expect(onHash).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledTimes(3);
  });
});

vi.mock("@sentry/node", { spy: true });
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal<typeof timers>();
  return { ...original, setTimeout: (...arguments_: unknown[]) => original.setTimeout(500, ...arguments_.slice(1)) };
});

afterEach(() => vi.resetAllMocks());
