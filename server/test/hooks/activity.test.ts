import "../mocks/alchemy";
import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/onesignal";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import {
  bytesToHex,
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

import database, { credentials } from "../../database";
import app from "../../hooks/activity";
import * as decodePublicKey from "../../utils/decodePublicKey";
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
      expect.anything(),
    );

    expect(response.status).toBe(200);
  });

  it("deploy account for non market asset", async () => {
    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

    const response = await appClient.index.$post({
      ...activityPayload,
      json: {
        ...activityPayload.json,
        event: {
          ...activityPayload.json.event,
          activity: [{ ...activityPayload.json.event.activity[2], toAddress: account }],
        },
      },
    });

    await vi.waitUntil(
      () => waitForTransactionReceipt.mock.settledResults.some(({ type }) => type !== "incomplete"),
      26_666,
    );

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

    expect(sendPushNotification).not.toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
  });
});

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
