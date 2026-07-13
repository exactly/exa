import { createWebhook as createWebhookMock, findWebhook as findWebhookMock } from "../mocks/alchemy";
import "../mocks/deployments";
import sendPushNotificationMock from "../mocks/onesignal";
import "../mocks/sentry";

import { captureException, setUser } from "@sentry/node";
import { testClient } from "hono/testing";
import { Redis } from "ioredis";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { hexToBytes, padHex, zeroAddress, zeroHash, type Address, type PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import database, { credentials } from "../../database";
import activity from "../../hooks/activity";
import t, { f } from "../../i18n";
import { setWebhookId, webhookId } from "../../utils/activityWebhook";
import { NETWORKS } from "../../utils/alchemy";
import appOrigin from "../../utils/appOrigin";
import redis from "../../utils/redis";

import type createPoke from "../../workers/poke/queue";

const mocks = vi.hoisted(() => ({
  closePoke: vi.fn<ReturnType<typeof createPoke>["close"]>().mockResolvedValue(),
  enqueuePoke: vi.fn<ReturnType<typeof createPoke>["enqueue"]>().mockResolvedValue(),
}));
vi.mock("../../workers/poke/queue", () => ({
  default: () => ({ close: mocks.closePoke, enqueue: mocks.enqueuePoke }),
}));

const hook = createHook("activity");
const appClient = testClient(hook.app);

beforeAll(() => hook.ready);
afterAll(() => {
  mocks.closePoke.mockReset().mockResolvedValue();
  return hook.close();
});

describe("address activity", () => {
  let owner: PrivateKeyAccount;
  let account: Address;

  beforeEach(async () => {
    mocks.enqueuePoke.mockReset().mockResolvedValue();
    owner = privateKeyToAccount(generatePrivateKey());
    account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner.address), y: zeroHash });

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
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
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
    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(sendPushNotification).not.toHaveBeenCalled();
  });

  it("omits the formatted amount when value is 0", async () => {
    const sendPushNotification = sendPushNotificationMock;
    const chain = NETWORKS.get("ETH_MAINNET");
    if (!chain) throw new Error("missing mainnet");
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

    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: [inject("WETH")],
      chainId: chain.id,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0, 5000);
    expect(sendPushNotification).toHaveBeenCalledWith({
      userId: account,
      headings: t("Funds received"),
      contents: t("{{amount}} received", { amount: "WETH" }),
    });
    expect(response.status).toBe(200);
  });

  it("queues eth when raw value is missing", async () => {
    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[0], toAddress: account, rawContract: {} }],
        },
      },
    });

    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(response.status).toBe(200);
  });

  it("queues eth when raw value is empty", async () => {
    const response = await appClient.index.$post({
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
    });

    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(response.status).toBe(200);
  });

  it("queues eth when value is missing", async () => {
    const { value: _, ...transfer } = activityPayload.json.event.activity[0];
    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: { ...activityPayload.json.event, activity: [{ ...transfer, toAddress: account }] },
      },
    });

    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(response.status).toBe(200);
  });

  it("queues tokens when value is missing", async () => {
    const { value: _, ...transfer } = activityPayload.json.event.activity[1];
    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [
            {
              ...transfer,
              toAddress: account,
              rawContract: { ...transfer.rawContract, address: inject("WETH") },
            },
          ],
        },
      },
    });

    expect(mocks.enqueuePoke).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: [inject("WETH")],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(response.status).toBe(200);
  });

  it("ignores zero raw values when value is missing", async () => {
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

    expect(mocks.enqueuePoke).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("queues one job per account with unique assets", async () => {
    const secondOwner = privateKeyToAccount(generatePrivateKey());
    const secondAccount = deriveAddress(inject("ExaAccountFactory"), { x: padHex(secondOwner.address), y: zeroHash });
    await database.insert(credentials).values({
      id: secondAccount,
      publicKey: new Uint8Array(hexToBytes(secondOwner.address)),
      account: secondAccount,
      factory: inject("ExaAccountFactory"),
    });

    const response = await appClient.index.$post({
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
            {
              ...activityPayload.json.event.activity[1],
              toAddress: account,
              rawContract: { ...activityPayload.json.event.activity[1].rawContract, address: inject("WETH") },
            },
            { ...activityPayload.json.event.activity[0], toAddress: secondAccount },
          ],
        },
      },
    });

    expect(mocks.enqueuePoke).toHaveBeenCalledTimes(2);
    expect(mocks.enqueuePoke).toHaveBeenNthCalledWith(1, {
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", inject("WETH")],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(mocks.enqueuePoke).toHaveBeenNthCalledWith(2, {
      account: secondAccount,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: secondOwner.address.toLowerCase(),
      salt: zeroAddress,
      source: null,
    });
    expect(setUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("fails the webhook when poke cannot be queued", async () => {
    const error = new Error("redis unavailable");
    const errorConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.enqueuePoke.mockRejectedValueOnce(error);

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

    expect(response.status).toBe(500);
    expect(errorConsole).toHaveBeenCalledWith(error);
    expect(mocks.enqueuePoke).toHaveBeenCalledOnce();
  });

  it("sends translated notification without symbol when asset is missing", async () => {
    const sendPushNotification = sendPushNotificationMock;

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

    await vi.waitUntil(() => sendPushNotification.mock.calls.length > 0);

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

    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.some(([captured]) => captured === error));

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

const activityPayload = {
  header: {},
  json: {
    id: "event",
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
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("webhook initialization", () => {
  beforeEach(() => {
    mocks.closePoke.mockReset().mockResolvedValue();
    mocks.enqueuePoke.mockReset().mockResolvedValue();
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
    expect(mocks.closePoke).toHaveBeenCalledOnce();
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
    onesignalKey: "onesignal",
    postgresUrl: parse(pipe(string(), nonEmpty()), env.POSTGRES_URL),
    redisUrl: parse(pipe(string(), nonEmpty()), env.REDIS_URL),
  });
}
