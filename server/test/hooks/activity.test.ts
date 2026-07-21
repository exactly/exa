import { createWebhook as createWebhookMock, findWebhook as findWebhookMock } from "../mocks/alchemy";
import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, setUser, startSpan } from "@sentry/node";
import { testClient } from "hono/testing";
import { Redis } from "ioredis";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import {
  BaseError,
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
  type withRetry,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, previewerAbi } from "@exactly/common/generated/chain";

import database, { credentials } from "../../database";
import activity from "../../hooks/activity";
import t, { f } from "../../i18n";
import { setWebhookId, webhookId } from "../../utils/activityWebhook";
import { NETWORKS } from "../../utils/alchemy";
import appOrigin from "../../utils/appOrigin";
import publicClient from "../../utils/publicClient";
import redis from "../../utils/redis";
import wallet from "../../utils/wallet";
import anvilClient from "../anvilClient";

const mocks = vi.hoisted(() => ({
  closeCredit: vi.fn<() => Promise<void>>().mockResolvedValue(),
  enqueueCredit: vi.fn<(account: Address) => Promise<void>>().mockResolvedValue(),
}));

vi.mock("../../workers/credit/queue", () => ({
  default: vi.fn(() => ({ close: mocks.closeCredit, enqueue: mocks.enqueueCredit })),
}));

const executor = privateKeyToAccount(padHex("0x69"));
const waitForReceipt = publicClient.waitForTransactionReceipt;

const hook = createHook("activity");
const appClient = testClient(hook.app);

beforeAll(() => hook.ready);
afterAll(() => {
  mocks.closeCredit.mockReset().mockResolvedValue();
  return hook.close();
});

describe("address activity", { timeout: 66_666 }, () => {
  let keeper: ReturnType<typeof wallet>;
  let owner: PrivateKeyAccount;
  let account: Address;

  beforeEach(async () => {
    mocks.closeCredit.mockReset().mockResolvedValue();
    mocks.enqueueCredit.mockReset().mockResolvedValue();
    keeper = wallet(executor);
    vi.mocked(wallet).mockReset().mockReturnValue(keeper);
    owner = privateKeyToAccount(generatePrivateKey());
    account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.address), y: zeroHash });
    vi.spyOn(publicClient, "waitForTransactionReceipt").mockImplementation((parameters) =>
      waitForReceipt({ ...parameters, pollingInterval: 10 }),
    );

    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(hexToBytes(owner.address)),
        account,
        factory: inject("ExaAccountFactory"),
      },
    ]);
  });

  afterEach(async () => {
    const keys = await redis.keys("lifi:tokens:*");
    if (keys.length > 0) await redis.del(...keys);
  });

  it("fails when a supported network disappears before handling", async () => {
    const errorConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(NETWORKS, "get").mockReturnValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- unreachable branch

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: { ...activityPayload.json.event, activity: [...activityPayload.json.event.activity] },
      },
    });

    expect(response.status).toBe(500);
    expect(errorConsole).toHaveBeenCalledWith(expect.objectContaining({ message: "unsupported activity network" }));
  });

  it("ignores transfers to unknown accounts", async () => {
    const sendPushNotification = sendPushNotificationMock;

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: { ...activityPayload.json.event, activity: [...activityPayload.json.event.activity] },
      },
    });

    expect(response.status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("captures no balance once after retries", async () => {
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

    await waitForActivity();

    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(1);
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "error")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fails with unexpected error", async () => {
    const chain = NETWORKS.get("ANVIL");
    if (!chain) throw new Error("missing anvil");
    const current = wallet(executor, chain);
    const getCode = vi.fn<typeof current.getCode>().mockRejectedValueOnce(new Error("Unexpected"));
    const createWallet = vi.mocked(wallet);
    createWallet.mockClear();
    createWallet.mockReturnValueOnce({ ...current, getCode });

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

    await waitForActivity();

    expect(getCode).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(new Error("Unexpected"), expect.objectContaining({ level: "error" }));
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fails with transaction timeout", async () => {
    const exaSend = keeper.exaSend;
    const poke = vi
      .fn<typeof keeper.exaSend>()
      .mockRejectedValue(new WaitForTransactionReceiptTimeoutError({ hash: zeroHash }));
    vi.spyOn(keeper, "exaSend").mockImplementation((spanOptions, call, options) =>
      spanOptions.op === "exa.poke" ? poke(spanOptions, call, options) : exaSend(spanOptions, call, options),
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

    await waitForActivity();

    expect(poke).toHaveBeenCalledTimes(6);
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ name: "WaitForTransactionReceiptTimeoutError" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);

    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by error name", async () => {
    const revertAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    failPoke(
      keeper,
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by reason", async () => {
    failPoke(
      keeper,
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "custom reason"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert as unknown", async () => {
    failPoke(
      keeper,
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints poke revert by signature", async () => {
    failPoke(
      keeper,
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0xdeadbeef"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by error name", async () => {
    const revertAbi = [{ type: "error", name: "Unauthorized", inputs: [] }] as const;
    failPoke(
      keeper,
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({
          abi: revertAbi,
          data: encodeErrorResult({ abi: revertAbi, errorName: "Unauthorized" }),
          functionName: "pokeETH",
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "Unauthorized"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by reason", async () => {
    failPoke(
      keeper,
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({ abi: [], functionName: "pokeETH", message: "custom reason" }),
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "custom reason"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry by signature", async () => {
    failPoke(
      keeper,
      new BaseError("test", {
        cause: new ContractFunctionRevertedError({ abi: [], data: "0xdeadbeef", functionName: "pokeETH" }),
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "0xdeadbeef"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry as unknown revert", async () => {
    failPoke(
      keeper,
      new BaseError("test", { cause: new ContractFunctionRevertedError({ abi: [], functionName: "pokeETH" }) }),
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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.any(BaseError),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("fingerprints shouldRetry as unknown", async () => {
    failPoke(keeper, new Error("unexpected"));

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

    await waitForWETHMarket(account, deposit);

    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "unexpected" }),
      expect.objectContaining({ level: "error", fingerprint: ["{{ default }}", "unknown"] }),
    );
    expect(
      vi.mocked(captureException).mock.calls.filter(([error, hint]) => isNoBalance(error, hint, "warning")),
    ).toHaveLength(0);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("ignores zero raw values when value is missing", async () => {
    const sendPushNotification = sendPushNotificationMock;
    const { value: _, ...transfer } = activityPayload.json.event.activity[1];

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...transfer, toAddress: account, rawContract: { address: inject("WETH"), rawValue: "0x0" } }],
        },
      },
    });

    expect(response.status).toBe(200);
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("pokes eth and queues credit", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const [response, market] = await Promise.all([
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
      waitForWETHMarket(account, deposit),
    ]);
    await vi.waitUntil(() => mocks.enqueueCredit.mock.calls.some(([queued]) => queued === account));

    expect(market.floatingDepositAssets).toBe(deposit);
    expect(market.isCollateral).toBe(true);
    expect(mocks.enqueueCredit.mock.calls.filter(([queued]) => queued === account)).toStrictEqual([[account]]);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("pokes eth with value when rawValue is missing", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const [response, market] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [{ ...activityPayload.json.event.activity[0], toAddress: account, rawContract: {} }],
          },
        },
      }),
      waitForWETHMarket(account, deposit),
    ]);

    expect(market.floatingDepositAssets).toBe(deposit);
    expect(market.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes eth with value when rawValue is 0x", async () => {
    const exaSend = vi.spyOn(keeper, "exaSend");
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const [response, market] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [
              { ...activityPayload.json.event.activity[0], toAddress: account, rawContract: { rawValue: "0x" } },
            ],
          },
        },
      }),
      waitForWETHMarket(account, deposit),
    ]);

    expect(
      exaSend.mock.calls.some(
        ([spanOptions, request]) =>
          spanOptions.op === "exa.poke" &&
          request.address === account &&
          "functionName" in request &&
          request.functionName === "pokeETH",
      ),
    ).toBe(true);
    expect(market.floatingDepositAssets).toBe(deposit);
    expect(market.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes eth without value", async () => {
    const exaSend = vi.spyOn(keeper, "exaSend");
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const eth = activityPayload.json.event.activity[0];
    const transfer = {
      fromAddress: eth.fromAddress,
      toAddress: account,
      hash: eth.hash,
      asset: eth.asset,
      category: eth.category,
      rawContract: eth.rawContract,
    };
    expect("value" in transfer).toBe(false);
    const [response, market] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [transfer],
          },
        },
      }),
      waitForWETHMarket(account, deposit),
    ]);

    expect(
      exaSend.mock.calls.some(
        ([spanOptions, request]) =>
          spanOptions.op === "exa.poke" &&
          request.address === account &&
          "functionName" in request &&
          request.functionName === "pokeETH",
      ),
    ).toBe(true);
    expect(market.floatingDepositAssets).toBe(deposit);
    expect(market.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes weth and eth", async () => {
    const eth = parseEther("5");
    await anvilClient.setBalance({ address: account, value: eth });

    const weth = parseEther("2");
    await anvilClient.writeContract({
      account: null,
      address: inject("WETH"),
      abi: mockERC20Abi,
      functionName: "mint",
      args: [account, weth],
    });

    const [response, market] = await Promise.all([
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
      waitForWETHMarket(account, eth + weth),
    ]);

    expect(market.floatingDepositAssets).toBe(eth + weth);
    expect(market.isCollateral).toBe(true);
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("pokes token without value", async () => {
    const exaSend = vi.spyOn(keeper, "exaSend");
    const weth = parseEther("2");
    await anvilClient.writeContract({
      account: null,
      address: inject("WETH"),
      abi: mockERC20Abi,
      functionName: "mint",
      args: [account, weth],
    });

    const token = activityPayload.json.event.activity[1];
    const transfer = {
      fromAddress: token.fromAddress,
      toAddress: account,
      hash: token.hash,
      asset: token.asset,
      category: token.category,
      rawContract: { ...token.rawContract, address: inject("WETH") },
    };
    expect("value" in transfer).toBe(false);
    const [response, market] = await Promise.all([
      appClient.index.$post({
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            ...activityPayload.json.event,
            activity: [transfer],
          },
        },
      }),
      waitForWETHMarket(account, weth),
    ]);

    expect(
      exaSend.mock.calls.some(
        ([spanOptions, request]) =>
          spanOptions.op === "exa.poke" &&
          request.address === account &&
          "functionName" in request &&
          request.functionName === "poke",
      ),
    ).toBe(true);
    expect(market.floatingDepositAssets).toBe(weth);
    expect(market.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("ignores token without value and zero rawValue", async () => {
    const exaSend = vi.spyOn(keeper, "exaSend");
    const sendPushNotification = sendPushNotificationMock;

    const token = activityPayload.json.event.activity[1];
    const transfer = {
      fromAddress: token.fromAddress,
      toAddress: account,
      hash: token.hash,
      asset: token.asset,
      category: token.category,
      rawContract: { address: inject("WETH"), rawValue: "0x0" as const },
    };
    expect("value" in transfer).toBe(false);
    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [transfer],
        },
      },
    });
    await vi.waitUntil(() => exaSend.mock.calls.length > 0, 333).catch(() => undefined);

    expect(
      exaSend.mock.calls.some(
        ([spanOptions, request]) =>
          spanOptions.op === "exa.poke" &&
          request.address === account &&
          "functionName" in request &&
          request.functionName === "poke",
      ),
    ).toBe(false);
    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("pokes multiple accounts", async () => {
    const deposit = parseEther("5");
    const owners = [
      owner,
      privateKeyToAccount(generatePrivateKey()),
      privateKeyToAccount(generatePrivateKey()),
    ] as const;
    const accounts = owners.map(({ address }) =>
      deriveAddress(inject("ExaAccountFactory"), { x: padHex(address), y: zeroHash }),
    );
    await Promise.all([
      ...owners.slice(1).map(({ address }, index) => {
        const credential = accounts[index + 1];
        if (!credential) throw new Error("missing account");
        return database.insert(credentials).values({
          id: credential,
          publicKey: new Uint8Array(hexToBytes(address)),
          account: credential,
          factory: inject("ExaAccountFactory"),
        });
      }),
      ...accounts.map((address) => anvilClient.setBalance({ address, value: deposit })),
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
      ...accounts.map((address) => waitForWETHMarket(address, deposit)),
    ]);

    expect(setUser).not.toHaveBeenCalled();
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
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  it("deploys on the event network without claiming yield", async () => {
    const sendPushNotification = sendPushNotificationMock;
    const chain = NETWORKS.get("ETH_MAINNET");
    if (!chain) throw new Error("missing mainnet");
    const eventWallet = wallet(executor, chain);
    const getCode = vi.fn<typeof eventWallet.getCode>().mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined -- absent code
    const eventExaSend = vi.fn<typeof eventWallet.exaSend>().mockResolvedValue(null);
    const createWallet = vi.mocked(wallet);
    createWallet.mockClear();
    createWallet.mockReturnValueOnce({ ...eventWallet, getCode, exaSend: eventExaSend });
    const keeperSend = vi.spyOn(keeper, "exaSend");
    mockLifiTokens({ 1: [{ address: inject("WETH") }] });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          network: "ETH_MAINNET",
          activity: [
            {
              ...activityPayload.json.event.activity[1],
              toAddress: account,
              rawContract: { address: inject("WETH") as Address, rawValue: "0x1" },
            },
          ],
        },
      },
    });

    await vi.waitUntil(() => eventExaSend.mock.calls.length > 0);

    expect(getCode).toHaveBeenCalledWith({ address: account });
    expect(createWallet).toHaveBeenCalledWith(expect.anything(), chain);
    expect(eventExaSend).toHaveBeenCalledWith(
      expect.objectContaining({ attributes: { account }, name: "create account", op: "exa.account" }),
      expect.objectContaining({
        abi: exaAccountFactoryAbi,
        address: inject("ExaAccountFactory") as Address,
        functionName: "createAccount",
      }),
      { fees: "auto" },
    );
    expect(keeperSend.mock.calls.some(([options]) => options.attributes?.account === account)).toBe(false);
    await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: t("Funds received"),
      contents: t("{{amount}} received", { amount: { en: "99.973 WETH", es: "99,973 WETH", pt: "99,973 WETH" } }),
    });
    expect(response.status).toBe(200);
  });

  it("omits the formatted amount when value is 0", async () => {
    const sendPushNotification = sendPushNotificationMock;
    mockLifiTokens({ 1: [{ address: inject("WETH") }] });

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          network: "ETH_MAINNET",
          activity: [
            {
              ...activityPayload.json.event.activity[1],
              toAddress: account,
              value: 0,
              rawContract: { address: inject("WETH") as Address, rawValue: "0x1" },
            },
          ],
        },
      },
    });

    await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: t("Funds received"),
      contents: t("{{amount}} received", { amount: "WETH" }),
    });
    expect(response.status).toBe(200);
  });

  it("sends translated notification without symbol when asset is missing", async () => {
    const sendPushNotification = sendPushNotificationMock;
    const amount = parseEther(String(activityPayload.json.event.activity[1].value));
    await anvilClient.writeContract({
      account: null,
      address: inject("WETH"),
      abi: mockERC20Abi,
      functionName: "mint",
      args: [account, amount],
    });

    const { asset: _, ...tokenWithoutAsset } = activityPayload.json.event.activity[1];
    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [
            {
              ...tokenWithoutAsset,
              toAddress: account,
              rawContract: { ...activityPayload.json.event.activity[1].rawContract, address: inject("WETH") },
            },
          ],
        },
      },
    });

    await Promise.all([
      vi.waitUntil(() => sendPushNotification.mock.calls.length > 0),
      waitForWETHMarket(account, amount),
    ]);

    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: t("Funds received"),
      contents: t("{{amount}} received and instantly started earning yield", { amount: f("99.973") }),
    });
    expect(response.status).toBe(200);
  });

  it("captures funds received notification errors", async () => {
    const error = new Error("push failed");
    sendPushNotificationMock.mockRejectedValueOnce(error);
    const amount = parseEther(String(activityPayload.json.event.activity[1].value));
    await anvilClient.writeContract({
      account: null,
      address: inject("WETH"),
      abi: mockERC20Abi,
      functionName: "mint",
      args: [account, amount],
    });

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
              rawContract: { ...activityPayload.json.event.activity[1].rawContract, address: inject("WETH") },
            },
          ],
        },
      },
    });

    await Promise.all([
      vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error)),
      waitForWETHMarket(account, amount),
    ]);

    expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
    expect(response.status).toBe(200);
  });

  it("doesn't send a notification for market shares", async () => {
    const sendPushNotification = sendPushNotificationMock;

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
              rawContract: { address: inject("MarketWETH"), rawValue: "0x1" },
            },
          ],
        },
      },
    });

    expect(sendPushNotification).not.toHaveBeenCalled();
    expect(setUser).toHaveBeenCalledWith({ id: account });
    expect(response.status).toBe(200);
  });

  describe("lifi token filter", () => {
    const optMainnet = NETWORKS.get("OPT_MAINNET");
    if (!optMainnet) throw new Error("missing OPT_MAINNET");
    const tokenAddress = "0x1111111111111111111111111111111111111111" as const;
    const optKey = `lifi:tokens:${optMainnet.id}`;

    function lifiPayload(toAddress: Address) {
      return {
        ...activityPayload,
        json: {
          ...activityPayload.json,
          event: {
            network: "OPT_MAINNET",
            activity: [
              {
                ...activityPayload.json.event.activity[2],
                toAddress,
                rawContract: {
                  rawValue: "0x00000000000000000000000000000000000000000000000000000000004c4b40" as const,
                  address: tokenAddress,
                },
              },
            ],
          },
        },
      };
    }

    it("fetches from lifi on cache miss and sends notification for known token", async () => {
      const sendPushNotification = sendPushNotificationMock;
      mockLifiTokens({ [optMainnet.id]: [{ address: tokenAddress }] });

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://li.quest/v1/tokens?chains=${optMainnet.id}`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      );
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("uses redis cache and skips fetch for known token on cache hit", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      await redis.multi().sadd(optKey, tokenAddress).expire(optKey, 120).exec(); // cspell:ignore sadd

      const sendPushNotification = sendPushNotificationMock;
      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(fetchSpy).not.toHaveBeenCalledWith(expect.stringContaining("li.quest"), expect.anything());
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("suppresses notification for unknown token when cache is initialized", async () => {
      const sendPushNotification = sendPushNotificationMock;

      await redis.multi().sadd(optKey, "0x2222222222222222222222222222222222222222").expire(optKey, 120).exec(); // cspell:ignore sadd

      const response = await appClient.index.$post(lifiPayload(account));

      expect(sendPushNotification).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it("fails open and captures exception when lifi fetch throws", async () => {
      const fetchError = new Error("network failure");
      mockLifiTokens(fetchError);
      const sendPushNotification = sendPushNotificationMock;

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(captureException).toHaveBeenCalledWith(fetchError, { level: "error" });
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("fails open and captures exception when lifi returns non ok", async () => {
      mockLifiTokens(Response.json({}, { status: 503 }));
      const sendPushNotification = sendPushNotificationMock;

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "lifi tokens 503" }), {
        level: "error",
      });
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("fails open and captures exception when redis errors", async () => {
      const redisError = new Error("redis connection refused");
      vi.spyOn(Redis.prototype, "pipeline").mockImplementationOnce(() => {
        throw redisError;
      });
      const sendPushNotification = sendPushNotificationMock;

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(captureException).toHaveBeenCalledWith(redisError, { level: "error" });
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("fails open when lifi returns empty token list", async () => {
      mockLifiTokens({});
      const sendPushNotification = sendPushNotificationMock;

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });

    it("fetches separately per chain and does not share cache between chains", async () => {
      const arbMainnet = NETWORKS.get("ARB_MAINNET");
      if (!arbMainnet) throw new Error("missing ARB_MAINNET");
      const arbKey = `lifi:tokens:${arbMainnet.id}`;
      await redis.multi().sadd(arbKey, tokenAddress).expire(arbKey, 120).exec(); // cspell:ignore sadd

      mockLifiTokens({ [optMainnet.id]: [{ address: tokenAddress }] });
      const sendPushNotification = sendPushNotificationMock;

      const response = await appClient.index.$post(lifiPayload(account));

      await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);

      expect(globalThis.fetch).toHaveBeenCalledWith(
        `https://li.quest/v1/tokens?chains=${optMainnet.id}`,
        expect.objectContaining({ signal: expect.any(AbortSignal) }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
      );
      expect(sendPushNotification).toHaveBeenCalledExactlyOnceWith({
        userId: account,
        headings: t("Funds received"),
        contents: t("{{amount}} received", { amount: { en: "5 USDT", es: "5 USDT", pt: "5 USDT" } }),
      });
      expect(response.status).toBe(200);
    });
  });
});

function failPoke(keeper: ReturnType<typeof wallet>, error: Error) {
  const { exaSend } = keeper;
  let failed = false;
  vi.spyOn(keeper, "exaSend").mockImplementation((spanOptions, call, options) => {
    if (failed || spanOptions.op !== "exa.poke") return exaSend(spanOptions, call, options);
    failed = true;
    return Promise.reject(error);
  });
}

async function getWETHMarket(account: Address) {
  const exactly = await publicClient.readContract({
    address: inject("Previewer"),
    functionName: "exactly",
    abi: previewerAbi,
    args: [account],
  });
  return exactly.find((market) => market.asset === inject("WETH"));
}

async function waitForWETHMarket(account: Address, floatingDepositAssets: bigint) {
  await waitForActivity();
  return vi.waitUntil(async () => {
    try {
      const market = await getWETHMarket(account);
      if (!market) return false;
      return market.floatingDepositAssets === floatingDepositAssets && market.isCollateral ? market : false;
    } catch (error) {
      if (
        error instanceof BaseError &&
        error.shortMessage.includes("Arithmetic operation resulted in underflow or overflow.")
      )
        return false;
      throw error;
    }
  }, 26_666);
}

async function waitForActivity() {
  const spans = vi.mocked(startSpan);
  await Promise.allSettled(
    spans.mock.calls.flatMap(([options], index) =>
      options.op === "exa.activity" ? [spans.mock.results[index]?.value as unknown] : [],
    ),
  );
}

function isNoBalance(error: unknown, hint: unknown, level: "error" | "warning") {
  const data = hint as Record<string, unknown> | undefined;
  return (
    error instanceof Error &&
    error.message === "NoBalance()" &&
    data?.level === level &&
    Array.isArray(data.fingerprint) &&
    data.fingerprint.join(":") === "{{ default }}:NoBalance"
  );
}

function mockLifiTokens(response: Error | Record<string, { address: string }[]> | Response) {
  const originalFetch = globalThis.fetch;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    if ((input instanceof Request ? input.url : String(input)).includes("li.quest")) {
      return response instanceof Error
        ? Promise.reject(response)
        : Promise.resolve(
            response instanceof Response ? response : Response.json({ tokens: response }, { status: 200 }),
          );
    }
    return originalFetch(input, init);
  });
}

const mockERC20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;

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
          rawContract: { rawValue: "0xe8d4a51000" },
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

vi.mock("@account-kit/infra", { spy: true });
vi.mock("@sentry/node", { spy: true });
vi.mock("viem", async (importOriginal) => {
  const original = await importOriginal<{ withRetry: typeof withRetry }>();
  return {
    ...original,
    withRetry: (
      callback: Parameters<typeof original.withRetry>[0],
      options: Parameters<typeof original.withRetry>[1],
    ) => original.withRetry(callback, { ...options, delay: 1 }),
  };
});

afterEach(async () => {
  await waitForActivity();
  vi.clearAllMocks();
  vi.restoreAllMocks();
}, 66_666);

describe("webhook initialization", () => {
  beforeEach(() => {
    mocks.closeCredit.mockReset().mockResolvedValue();
    mocks.enqueueCredit.mockReset().mockResolvedValue();
    setWebhookId("activity");
  });

  it("sets the existing webhook id", async () => {
    const existing: NonNullable<Awaited<ReturnType<typeof findWebhookMock>>> = {
      id: "existing-hook-id",
      is_active: true,
      network: "OPT_SEPOLIA",
      signing_key: "existing-signing-key",
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: `${appOrigin}/hooks/activity`,
    };
    vi.mocked(findWebhookMock).mockResolvedValueOnce(existing);
    const current = createHook("bootstrap-signing-key");

    await current.ready;

    expect(createWebhookMock).not.toHaveBeenCalled();
    expect(webhookId).toBe("existing-hook-id");
    const closing = current.close();
    expect(current.close()).toBe(closing);
    await closing;
    expect(mocks.closeCredit).toHaveBeenCalledOnce();
  });

  it("sets a newly created webhook id", async () => {
    vi.mocked(findWebhookMock).mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
    const current = createHook();

    await current.ready;

    expect(createWebhookMock).toHaveBeenCalledOnce();
    expect(webhookId).toBe("mock-webhook-id");
    await current.close();
  });

  it("preserves the webhook id when readiness fails", async () => {
    const error = new Error("alchemy error");
    vi.mocked(findWebhookMock).mockRejectedValueOnce(error);
    const current = createHook("activity");

    await expect(current.ready).rejects.toBe(error);

    expect(createWebhookMock).not.toHaveBeenCalled();
    expect(webhookId).toBe("activity");
    await current.close();
  });
});

function createHook(activityKey?: string) {
  return activity({
    alchemyKey: "webhooks",
    activityKey,
    executor,
    onesignalKey: "onesignal",
    postgresUrl: parse(pipe(string(), nonEmpty()), env.POSTGRES_URL),
    redisUrl: parse(pipe(string(), nonEmpty()), env.REDIS_URL),
    segmentKey: "segment",
  });
}
