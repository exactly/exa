import { createWebhook as createWebhookMock, findWebhook as findWebhookMock } from "../mocks/alchemy";
import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/sentry";
import "../mocks/wallet";

import { captureException, setUser } from "@sentry/node";
import { testClient } from "hono/testing";
import { hexToBytes, padHex, zeroHash, type Address, type PrivateKeyAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";

import database, { credentials } from "../../database";
import app from "../../hooks/activity";
import t, { f } from "../../i18n";
import { NETWORKS } from "../../utils/alchemy";
import * as onesignal from "../../utils/onesignal";
import redis from "../../utils/redis";
import { enqueue } from "../../workers/poke/queue";

const appClient = testClient(app);

vi.mock("../../workers/poke/queue", () => ({ enqueue: vi.fn<typeof enqueue>() }));

describe("address activity", () => {
  let owner: PrivateKeyAccount;
  let account: Address;

  beforeEach(async () => {
    vi.mocked(enqueue).mockReset().mockResolvedValue();
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

  it("omits the formatted amount when value is 0", async () => {
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
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

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: [inject("WETH")],
      chainId: chain.id,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
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

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
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

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
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

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
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

    expect(enqueue).toHaveBeenCalledExactlyOnceWith({
      account,
      assets: [inject("WETH")],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
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

    expect(enqueue).not.toHaveBeenCalled();
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

    expect(enqueue).toHaveBeenCalledTimes(2);
    expect(enqueue).toHaveBeenNthCalledWith(1, {
      account,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", inject("WETH")],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: owner.address.toLowerCase(),
      source: null,
    });
    expect(enqueue).toHaveBeenNthCalledWith(2, {
      account: secondAccount,
      assets: ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE"],
      chainId: 31_337,
      factory: inject("ExaAccountFactory"),
      origin: "activity",
      publicKey: secondOwner.address.toLowerCase(),
      source: null,
    });
    expect(setUser).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("fails the webhook when poke cannot be queued", async () => {
    const error = new Error("redis unavailable");
    const errorConsole = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(enqueue).mockRejectedValueOnce(error);

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
    expect(enqueue).toHaveBeenCalledOnce();
  });

  it("sends translated notification without symbol when asset is missing", async () => {
    const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
    vi.spyOn(onesignal, "sendPushNotification").mockRejectedValueOnce(error);

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
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
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

      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");
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
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

      await redis.multi().sadd(optKey, "0x2222222222222222222222222222222222222222").expire(optKey, 120).exec(); // cspell:ignore sadd

      const response = await appClient.index.$post(lifiPayload(account));

      expect(sendPushNotification).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
    });

    it("fails open and captures exception when lifi fetch throws", async () => {
      const fetchError = new Error("network failure");
      mockLifiTokens(fetchError);
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
      vi.spyOn(redis, "pipeline").mockImplementationOnce(() => {
        throw redisError;
      });
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
      const sendPushNotification = vi.spyOn(onesignal, "sendPushNotification");

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
  beforeEach(() => vi.resetModules());

  it("sets webhookId when existing hook is found", async () => {
    vi.mocked(findWebhookMock).mockResolvedValueOnce({ id: "existing-hook-id", signing_key: "existing-signing-key" });
    const activity = await import("../../hooks/activity");
    await vi.waitUntil(() => activity.webhookId === "existing-hook-id", 5000);
    expect(activity.webhookId).toBe("existing-hook-id");
  });

  it("sets webhookId when a hook is created", async () => {
    vi.mocked(findWebhookMock).mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- create path
    const activity = await import("../../hooks/activity");
    await vi.waitUntil(() => activity.webhookId === "mock-webhook-id", 5000);
    expect(createWebhookMock).toHaveBeenCalledOnce();
    expect(activity.webhookId).toBe("mock-webhook-id");
  });

  it("reads webhookId from env", async () => {
    const previous = process.env.ALCHEMY_ACTIVITY_ID;
    try {
      process.env.ALCHEMY_ACTIVITY_ID = "hook-a";
      vi.mocked(findWebhookMock).mockRejectedValueOnce(new Error("alchemy error"));
      const activity = await import("../../hooks/activity");
      expect(activity.webhookId).toBe("hook-a");
    } finally {
      if (previous === undefined) delete process.env.ALCHEMY_ACTIVITY_ID;
      else process.env.ALCHEMY_ACTIVITY_ID = previous;
    }
  });

  it("captures exception when webhook initialization fails", async () => {
    const error = new Error("alchemy error");
    vi.mocked(findWebhookMock).mockRejectedValueOnce(error);
    const { captureException: ce } = await import("@sentry/node");
    await import("../../hooks/activity");
    await vi.waitUntil(() => vi.mocked(ce).mock.calls.some(([error_]) => error_ === error), 5000);
    expect(ce).toHaveBeenCalledWith(error, { level: "error" });
  });
});
