import "../mocks/sentry";
import "../mocks/deployments";
import { nonceSource, keeperClient } from "../mocks/keeper"; // eslint-disable-line import/order

import { captureException } from "@sentry/node";
import type * as timers from "node:timers/promises";
import type { Hex } from "viem";
import { afterEach, describe, expect, inject, it, vi } from "vitest";

import { auditorAbi } from "../../generated/contracts";
import keeper from "../../utils/keeper";
import nonceManager from "../../utils/nonceManager";
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

  it("resets nonce when skipped", async () => {
    const waitForTransactionReceipt = publicClient.waitForTransactionReceipt;
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
      waitForTransactionReceipt({ ...parameters, timeout: 100 }),
    );
    const hardReset = vi.spyOn(nonceManager, "hardReset");
    const currentNonce = await nonceSource.get({
      address: keeperClient.account.address,
      chainId: keeperClient.chain.id,
      client: keeperClient,
    });
    const getNonce = vi.spyOn(nonceSource, "get");
    getNonce
      .mockResolvedValueOnce(currentNonce)
      .mockResolvedValueOnce(currentNonce + 2)
      .mockResolvedValueOnce(currentNonce + 1);

    const onHash = vi.fn<() => void>();
    await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash },
    );

    const blockedHashes: Hex[] = [];
    const sendBlocked = await Promise.allSettled([
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { onHash: (hash) => blockedHashes.push(hash) },
      ),
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { onHash: (hash) => blockedHashes.push(hash) },
      ),
    ]);

    expect(sendBlocked).toMatchObject(
      sendBlocked.map(() => ({ status: "rejected", reason: { name: "WaitForTransactionReceiptTimeoutError" } })),
    );

    await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash },
    );

    expect(hardReset).toHaveBeenCalledWith({
      address: keeper.account.address,
      chainId: keeper.chain.id,
    });
    await expect(
      Promise.all(blockedHashes.map((hash) => publicClient.waitForTransactionReceipt({ hash }))),
    ).resolves.toMatchObject(blockedHashes.map(() => ({ status: "success" })));
  });

  it("resets nonce with 100 transactions blocked", async () => {
    const waitForTransactionReceipt = publicClient.waitForTransactionReceipt;
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
      waitForTransactionReceipt({ ...parameters, timeout: 100 }),
    );
    const hardReset = vi.spyOn(nonceManager, "hardReset");
    const currentNonce = await nonceSource.get({
      address: keeperClient.account.address,
      chainId: keeperClient.chain.id,
      client: keeperClient,
    });

    const getNonce = vi.spyOn(nonceSource, "get");
    [currentNonce, currentNonce + 2, currentNonce + 1].map((nonce) => getNonce.mockResolvedValueOnce(nonce));
    const hashes: Hex[] = [];

    await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash) => hashes.push(hash) },
    );

    const sendBlocked = await Promise.allSettled(
      Array.from({ length: 100 }, (_, index) =>
        keeper.exaSend(
          { name: `test transfer ${index}`, op: `test.transfer[${index}]` },
          { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
          { onHash: (hash) => hashes.push(hash) },
        ),
      ),
    );

    expect(sendBlocked).toMatchObject(
      sendBlocked.map(() => ({
        status: "rejected",
        reason: { name: "WaitForTransactionReceiptTimeoutError" },
      })),
    );

    await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash) => hashes.push(hash) },
    );

    await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        keeper.exaSend(
          { name: `test transfer ${index}`, op: `test.transfer[${index}]` },
          { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
          { onHash: (hash) => hashes.push(hash) },
        ),
      ),
    );

    expect(hardReset).toHaveBeenCalledWith({ address: keeper.account.address, chainId: keeper.chain.id });
    await expect(Promise.all(hashes.map((hash) => waitForTransactionReceipt({ hash })))).resolves.toMatchObject(
      hashes.map(() => ({ status: "success" })),
    );
  });
});

vi.mock("@sentry/node", { spy: true });
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal<typeof timers>();
  return { ...original, setTimeout: (...arguments_: unknown[]) => original.setTimeout(500, ...arguments_.slice(1)) };
});

afterEach(() => vi.resetAllMocks());
