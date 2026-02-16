import "../mocks/alchemy";
import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/onesignal";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import {
  BaseError,
  bytesToHex,
  ContractFunctionRevertedError,
  encodeErrorResult,
  hexToBigInt,
  hexToBytes,
  padHex,
  parseEther,
  WaitForTransactionReceiptTimeoutError,
  zeroHash,
  type Address,
  type PrivateKeyAccount,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, previewerAbi } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import app from "../../hooks/activity";
import * as decodePublicKey from "../../utils/decodePublicKey";
import keeper from "../../utils/keeper";
import * as onesignal from "../../utils/onesignal";
import publicClient from "../../utils/publicClient";
import anvilClient from "../anvilClient";

const appClient = testClient(app);

describe("address activity", () => {
  let owner: PrivateKeyAccount;
  let account: Address;

  beforeEach(async () => {
    owner = privateKeyToAccount(generatePrivateKey());
    account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.address), y: zeroHash });
    vi.spyOn(decodePublicKey, "default").mockImplementation((bytes) => ({ x: padHex(bytesToHex(bytes)), y: zeroHash }));

    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(hexToBytes(owner.address)),
        account,
        factory: inject("ExaAccountFactory"),
      },
    ]);
  });

  it("captures no balance once after retries", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    vi.spyOn(keeper, "exaSend").mockImplementation((spanOptions) =>
      Promise.resolve(
        spanOptions.op === "exa.poke" ? null : ({ status: "success" } as Awaited<ReturnType<typeof keeper.exaSend>>),
      ),
    );

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(
      () => vi.mocked(captureException).mock.calls.some(([error, hint]) => isNoBalance(error, hint, "warning")),
      26_666,
    );

    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(1);
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "error")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fails with unexpected error", async () => {
    const getCode = vi.spyOn(publicClient, "getCode");
    getCode.mockRejectedValue(new Error("Unexpected"));

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => getCode.mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(new Error("Unexpected"), expect.objectContaining({ level: "error" }));
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);

    expect(response.status).toBe(200);
  });

  it("fails with transaction timeout", async () => {
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockRejectedValue(
      new WaitForTransactionReceiptTimeoutError({ hash: zeroHash }),
    );

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      new WaitForTransactionReceiptTimeoutError({ hash: zeroHash }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);

    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by error name", async () => {
    const simulateContract = vi.spyOn(publicClient, "simulateContract");
    const revertAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    simulateContract.mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({
          abi: revertAbi,
          data: encodeErrorResult({ abi: revertAbi, errorName: "Unauthorized" }),
          functionName: "poke",
        }),
      }),
    );

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by reason", async () => {
    const simulateContract = vi.spyOn(publicClient, "simulateContract");
    simulateContract.mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({ abi: [], functionName: "poke", message: "custom reason" }),
      }),
    );

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "custom reason"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert as unknown", async () => {
    const simulateContract = vi.spyOn(publicClient, "simulateContract");
    simulateContract.mockRejectedValueOnce(
      new BaseError("test", { cause: new ContractFunctionRevertedError({ abi: [], functionName: "poke" }) }),
    );

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by signature", async () => {
    const simulateContract = vi.spyOn(publicClient, "simulateContract");
    simulateContract.mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({
          abi: [],
          data: "0xdeadbeef",
          functionName: "poke",
        }),
      }),
    );

    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0xdeadbeef"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by error name", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    const revertAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({
          abi: revertAbi,
          data: encodeErrorResult({ abi: revertAbi, errorName: "Unauthorized" }),
          functionName: "pokeETH",
        }),
      }),
    );

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0, 26_666);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by reason", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({ abi: [], functionName: "pokeETH", message: "custom reason" }),
      }),
    );

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0, 26_666);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "custom reason"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by signature", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce(
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({ abi: [], data: "0xdeadbeef", functionName: "pokeETH" }),
      }),
    );

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0, 26_666);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0xdeadbeef"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry as unknown revert", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce(
      new BaseError("test", { cause: new ContractFunctionRevertedError({ abi: [], functionName: "pokeETH" }) }),
    );

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0, 26_666);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry as unknown", async () => {
    vi.spyOn(publicClient, "getCode").mockResolvedValue("0x1");
    vi.spyOn(publicClient, "simulateContract").mockRejectedValueOnce(new Error("unexpected"));

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0, 26_666);

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "unexpected" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(response.status).toBe(200);
  });

  it("pokes eth", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const [response] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [{ ...activityPayload.json.event.activity[0], toAddress: account }],
          },
        },
      }),
      waitForWethMarket(account, deposit),
    ]);

    const market = await getWethMarket(account);

    expect(market?.floatingDepositAssets).toBe(deposit);
    expect(market?.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes weth and eth", async () => {
    const eth = parseEther("5");
    await anvilClient.setBalance({ address: account, value: eth });

    const weth = parseEther("2");
    await keeper.exaSend(
      { name: "mint", op: "tx.mint" },
      { address: inject("WETH"), abi: mockERC20Abi, functionName: "mint", args: [account, weth] },
    );

    const [response] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [
              { ...activityPayload.json.event.activity[0], toAddress: account },
              {
                ...activityPayload.json.event.activity[1],
                toAddress: account,
                rawContract: { ...activityPayload.json.event.activity[1].rawContract, address: inject("WETH") },
              },
            ],
          },
        },
      }),
      waitForWethMarket(account, eth + weth),
    ]);

    const market = await getWethMarket(account);

    expect(market?.floatingDepositAssets).toBe(eth + weth);
    expect(market?.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes multiple accounts", async () => {
    const owners = [
      owner,
      privateKeyToAccount(generatePrivateKey()),
      privateKeyToAccount(generatePrivateKey()),
    ] as const;
    const accounts = owners.map(({ address }) =>
      deriveAddress(inject("ExaAccountFactory"), { x: padHex(address), y: zeroHash }),
    );
    await Promise.all([
      ...accounts.slice(1).map((id) =>
        database.insert(credentials).values({
          id,
          publicKey: new Uint8Array(hexToBytes(id)),
          account: id,
          factory: inject("ExaAccountFactory"),
        }),
      ),
      ...accounts.map((address) => anvilClient.setBalance({ address, value: parseEther("5") })),
      keeper.exaSend(
        { name: "create account", op: "exa.account" },
        {
          address: inject("ExaAccountFactory"),
          abi: exaAccountFactoryAbi,
          functionName: "createAccount",
          args: [0n, [{ x: hexToBigInt(owners[0].address), y: 0n }]],
        },
      ),
    ]);

    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");
    const initialSettledResults = waitForTransactionReceipt.mock.settledResults.length;
    const [response] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: accounts.map((toAddress) => ({ ...activityPayload.json.event.activity[0], toAddress })),
          },
        },
      }),
      vi.waitUntil(
        () =>
          waitForTransactionReceipt.mock.settledResults
            .slice(initialSettledResults)
            .filter(({ type }) => type !== "incomplete").length >= 5,
        26_666,
      ),
    ]);

    expect(response.status).toBe(200);
  });

  it("deploy account for non market asset", async () => {
    const [response] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [{ ...activityPayload.json.event.activity[2], toAddress: account }],
          },
        },
      }),
      vi.waitUntil(async () => !!(await publicClient.getCode({ address: account })), 26_666),
    ]);

    const deployed = !!(await publicClient.getCode({ address: account }));

    expect(deployed).toBe(true);
    expect(response.status).toBe(200);
  });

  it("doesn't send a notification for market shares", async () => {
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [
            {
              ...activityPayload.json.event.activity[1],
              toAddress: account,
              rawContract: { address: inject("MarketWETH") },
            },
          ],
        },
      },
    });

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });
});

async function getWethMarket(account: Address) {
  const exactly = await publicClient.readContract({
    address: inject("Previewer"),
    functionName: "exactly",
    abi: previewerAbi,
    args: [account],
  });

  return exactly.find((m) => m.asset === inject("WETH"));
}

async function waitForWethMarket(account: Address, floatingDepositAssets: bigint) {
  await vi.waitUntil(async () => {
    const market = await getWethMarket(account);

    return market?.floatingDepositAssets === floatingDepositAssets && market.isCollateral;
  }, 26_666);
}

function isNoBalance(error: unknown, hint: unknown, level: "error" | "warning") {
  const data = hint as Record<string, unknown> | undefined;
  return (
    error instanceof Error &&
    error.message === "NoBalance()" &&
    data?.level === level &&
    Array.isArray(data.fingerprint) &&
    data.fingerprint.join(":") === "{{ default }}:NoBalance()"
  );
}

const activityPayload = {
  header: {},
  json: {
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "ANVIL",
      activity: [
        {
          fromAddress: "0x3372cf7cad49a330f7b7403eaa544444d5985877",
          toAddress: "0x34716d493d69b11fd52d3242cf1eeec8585a1491",
          hash: "0x9848781a8540d8d724ed86d3565506ab35eb309b332c52fef2cef22195dd184f",
          value: 0.000_001,
          asset: "ETH",
          category: "external",
          rawContract: {},
        },
        {
          fromAddress: "0xacd03d601e5bb1b275bb94076ff46ed9d753435a",
          toAddress: "0xbaff9578e9f473ffa1431334d57fdc153e759153",
          hash: "0x2c459cae2c7cb48394c5272c67dccc71f7f251cff2cbb36b8efb9b3c9f16656b",
          value: 99.973,
          asset: "WETH",
          category: "token",
          rawContract: {
            rawValue: "0x0000000000000000000000000000000000000000000000000000000005f57788",
            address: "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
            decimals: 18,
          },
        },
        {
          fromAddress: "0x6d37817d118f72f362cf01e64d9454bdd8e8e92f",
          toAddress: "0xad0e941d2693286581520d320fd37377387cd868",
          blockNum: "0x88e6e99",
          hash: "0xd297a8fbd58223c82ea80ff6a730d210cde78a5774e263fa33f589ce249e39e9",
          value: 5,
          asset: "USDT",
          category: "token",
          rawContract: {
            rawValue: "0x00000000000000000000000000000000000000000000000000000000004c4b40",
            address: "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
            decimals: 6,
          },
        },
      ],
    },
  },
} as const;

vi.mock("@sentry/node", { spy: true });

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

const mockERC20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
