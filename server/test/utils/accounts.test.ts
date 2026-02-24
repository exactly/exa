import { keeperClient, nonceSource } from "../mocks/accounts";
import "../mocks/deployments";
import "../mocks/sentry";

import { captureException, withScope } from "@sentry/node";
import { setImmediate } from "node:timers/promises";
import { encodeErrorResult, getContractError, RawContractError } from "viem";
import { afterEach, describe, expect, inject, it, vi } from "vitest";

import { auditorAbi } from "@exactly/common/generated/chain";

import { keeper } from "../../utils/accounts";
import nonceManager from "../../utils/nonceManager";
import publicClient from "../../utils/publicClient";

import type { Hash, Hex } from "@exactly/common/validation";
import type * as sentry from "@sentry/node";
import type * as timers from "node:timers/promises";

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
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "WaitForTransactionReceiptTimeoutError" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(onHash).toHaveBeenCalledOnce();
    expect(sendRawTransaction).toHaveBeenCalledTimes(3);
  });

  it("resets nonce when skipped", async () => {
    const waitForTransactionReceipt = publicClient.waitForTransactionReceipt;
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

    const mockWaitForTransactionReceipt = vi
      .spyOn(publicClient, "waitForTransactionReceipt")
      .mockImplementation((parameters) => waitForTransactionReceipt({ ...parameters, timeout: 1100 }));

    const blockedHashes: Hex[] = [];
    const first = keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash: Hash) => blockedHashes.push(hash) },
    );
    await vi.waitUntil(() => blockedHashes.length === 1);
    const second = keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash: Hash) => blockedHashes.push(hash) },
    );
    const sendBlocked = await Promise.allSettled([first, second]);

    expect(sendBlocked).toMatchObject(
      sendBlocked.map(() => ({ status: "rejected", reason: { name: "WaitForTransactionReceiptTimeoutError" } })),
    );

    mockWaitForTransactionReceipt.mockRestore();
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
      { onHash: (hash: Hash) => hashes.push(hash) },
    );

    const mockWaitForTransactionReceipt = vi
      .spyOn(publicClient, "waitForTransactionReceipt")
      .mockImplementation((parameters) => waitForTransactionReceipt({ ...parameters, timeout: 1100 }));

    const first = keeper.exaSend(
      { name: "test transfer 0", op: "test.transfer[0]" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash: Hash) => hashes.push(hash) },
    );
    await setImmediate();
    const second = keeper.exaSend(
      { name: "test transfer 1", op: "test.transfer[1]" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash: Hash) => hashes.push(hash) },
    );
    await setImmediate();
    const sendBlocked = await Promise.allSettled([
      first,
      second,
      ...Array.from({ length: 98 }, (_, index) =>
        keeper.exaSend(
          { name: `test transfer ${index + 2}`, op: `test.transfer[${index + 2}]` },
          { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
          { onHash: (hash: Hash) => hashes.push(hash) },
        ),
      ),
    ]);

    expect(sendBlocked).toMatchObject(
      sendBlocked.map(() => ({
        status: "rejected",
        reason: { name: "WaitForTransactionReceiptTimeoutError" },
      })),
    );

    mockWaitForTransactionReceipt.mockRestore();

    await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      { onHash: (hash: Hash) => hashes.push(hash) },
    );

    await vi.waitUntil(
      async () =>
        (await nonceSource.get({
          address: keeperClient.account.address,
          chainId: keeperClient.chain.id,
          client: keeperClient,
        })) ===
        currentNonce + 102,
    );

    await Promise.allSettled(
      Array.from({ length: 20 }, (_, index) =>
        keeper.exaSend(
          { name: `test transfer ${index}`, op: `test.transfer[${index}]` },
          { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
          { onHash: (hash: Hash) => hashes.push(hash) },
        ),
      ),
    );

    expect(hardReset).toHaveBeenCalledWith({ address: keeper.account.address, chainId: keeper.chain.id });
    await expect(Promise.all(hashes.map((hash) => waitForTransactionReceipt({ hash })))).resolves.toMatchObject(
      hashes.map(() => ({ status: "success" })),
    );
  });
});

describe("user identity", () => {
  it("sets sentry user when account attribute is valid address", async () => {
    const setUser = await spyScopeSetUser();
    const account = inject("Auditor");
    const receipt = await keeper.exaSend(
      { name: "test transfer", op: "test.transfer", attributes: { account } },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
    );
    expect(receipt?.status).toBe("success");
    expect(setUser).toHaveBeenCalledWith({ id: account });
  });

  it("skips sentry user without account attribute", async () => {
    const setUser = await spyScopeSetUser();
    const receipt = await keeper.exaSend(
      { name: "test transfer", op: "test.transfer" },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
    );
    expect(receipt?.status).toBe("success");
    expect(setUser).not.toHaveBeenCalled();
  });

  it("skips sentry user with invalid account attribute", async () => {
    const setUser = await spyScopeSetUser();
    const receipt = await keeper.exaSend(
      { name: "test transfer", op: "test.transfer", attributes: { account: "0xInvalid" } },
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
    );
    expect(receipt?.status).toBe("success");
    expect(setUser).not.toHaveBeenCalled();
  });
});

describe("level option", () => {
  it("defaults to error", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
      throw new Error("operational failure");
    });
    const initialCalls = vi.mocked(captureException).mock.calls.length;
    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      ),
    ).rejects.toThrow("operational failure");
    const calls = vi.mocked(captureException).mock.calls.slice(initialCalls);
    expect(calls).toContainEqual([
      expect.objectContaining({ message: "operational failure" }),
      expect.objectContaining({ level: "error" }),
    ]);
  });

  it("captures with static warning level", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
      throw new Error("test warning");
    });
    const initialCalls = vi.mocked(captureException).mock.calls.length;
    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { level: "warning" },
      ),
    ).rejects.toThrow("test warning");
    const calls = vi.mocked(captureException).mock.calls.slice(initialCalls);
    expect(calls).toContainEqual([
      expect.objectContaining({ message: "test warning" }),
      expect.objectContaining({ level: "warning" }),
    ]);
  });

  it("suppresses capture with false", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
      throw new Error("suppressed");
    });
    const initialCalls = vi.mocked(captureException).mock.calls.length;
    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { level: false },
      ),
    ).rejects.toThrow("suppressed");
    const calls = vi.mocked(captureException).mock.calls.slice(initialCalls);
    expect(calls.some(([error]) => error instanceof Error && error.message === "suppressed")).toBe(false);
  });

  it("calls level function with reason and error", async () => {
    const contractError = getContractError(
      new RawContractError({ data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientShortfall" }) }),
      { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
    );
    vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
      throw contractError; // eslint-disable-line @typescript-eslint/only-throw-error -- returns error
    });
    const levelFunction = vi
      .fn<(reason: string, error: unknown) => "error" | "warning" | false>()
      .mockReturnValue("warning");
    const initialCalls = vi.mocked(captureException).mock.calls.length;
    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { level: levelFunction },
      ),
    ).rejects.toThrow();
    expect(levelFunction).toHaveBeenCalledWith(expect.stringContaining("InsufficientShortfall"), contractError);
    const calls = vi.mocked(captureException).mock.calls.slice(initialCalls);
    expect(calls).toContainEqual([contractError, expect.objectContaining({ level: "warning" })]);
  });

  it("suppresses capture when level function returns false", async () => {
    vi.spyOn(publicClient, "simulateContract").mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- returns error
      throw getContractError(
        new RawContractError({ data: encodeErrorResult({ abi: auditorAbi, errorName: "InsufficientShortfall" }) }),
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
      );
    });
    const initialCalls = vi.mocked(captureException).mock.calls.length;
    await expect(
      keeper.exaSend(
        { name: "test transfer", op: "test.transfer" },
        { address: inject("Auditor"), abi: auditorAbi, functionName: "enterMarket", args: [inject("MarketUSDC")] },
        { level: () => false },
      ),
    ).rejects.toThrow();
    const calls = vi.mocked(captureException).mock.calls.slice(initialCalls);
    expect(
      calls.some(
        ([error]) => error instanceof Error && "functionName" in error && error.functionName === "enterMarket",
      ),
    ).toBe(false);
  });
});

vi.mock("@sentry/node", { spy: true });
vi.mock("node:timers/promises", async (importOriginal) => {
  const original = await importOriginal<typeof timers>();
  return { ...original, setTimeout: (...arguments_: unknown[]) => original.setTimeout(500, ...arguments_.slice(1)) };
});

afterEach(() => vi.restoreAllMocks());

async function spyScopeSetUser() {
  const { withScope: realWithScope } = await vi.importActual<typeof sentry>("@sentry/node");
  const setUser = vi.fn();
  vi.mocked(withScope).mockImplementationOnce((_scopeOrCallback, _callback?) =>
    realWithScope((scope) => {
      const originalSetUser = scope.setUser.bind(scope);
      scope.setUser = (...args: Parameters<typeof scope.setUser>) => {
        setUser(...args);
        return originalSetUser(...args);
      };
      return ((_callback ?? _scopeOrCallback) as NonNullable<typeof _callback>)(scope);
    }),
  );
  return setUser;
}
