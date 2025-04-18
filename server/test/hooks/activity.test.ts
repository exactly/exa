import "../mocks/sentry";
import "../mocks/alchemy";
import "../mocks/database";
import "../mocks/deployments";
import "../mocks/onesignal";
import "../mocks/keeper";

import { exaAccountFactoryAbi } from "@exactly/common/generated/chain";
import { captureException } from "@sentry/node";
import { testClient } from "hono/testing";
import {
  type Address,
  bytesToHex,
  hexToBigInt,
  hexToBytes,
  padHex,
  parseEther,
  type PrivateKeyAccount,
  WaitForTransactionReceiptTimeoutError,
  zeroHash,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import database, { credentials } from "../../database";
import { previewerAbi } from "../../generated/contracts";
import app from "../../hooks/activity";
import * as decodePublicKey from "../../utils/decodePublicKey";
import deriveAddress from "../../utils/deriveAddress";
import keeper from "../../utils/keeper";
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

    await database
      .insert(credentials)
      .values([{ id: account, publicKey: hexToBytes(owner.address), account, factory: inject("ExaAccountFactory") }]);
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

    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

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

    await vi.waitUntil(() => waitForTransactionReceipt.mock.calls.length > 0);

    expect(captureException).toHaveBeenCalledWith(
      new WaitForTransactionReceiptTimeoutError({ hash: zeroHash }),
      expect.anything(),
    );

    expect(response.status).toBe(200);
  });

  it("pokes eth", async () => {
    const deposit = parseEther("5");
    await anvilClient.setBalance({ address: account, value: deposit });

    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

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

    await vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length >= 2, 16_666);

    const exactly = await publicClient.readContract({
      address: inject("Previewer"),
      functionName: "exactly",
      abi: previewerAbi,
      args: [account],
    });

    const market = exactly.find((m) => m.asset === inject("WETH"));

    expect(market?.floatingDepositAssets).toBe(deposit);
    expect(market?.isCollateral).toBe(true);
    expect(response.status).toBe(200);
  });

  it("pokes weth and eth", async () => {
    const eth = parseEther("5");
    await anvilClient.setBalance({ address: account, value: eth });

    const weth = parseEther("2");
    await keeper.writeContract({
      address: inject("WETH"),
      abi: [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }] }],
      functionName: "mint",
      args: [account, weth],
    });

    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");

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
          ],
        },
      },
    });

    await vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length >= 3, 16_666);

    const exactly = await publicClient.readContract({
      address: inject("Previewer"),
      functionName: "exactly",
      abi: previewerAbi,
      args: [account],
    });

    const market = exactly.find((m) => m.asset === inject("WETH"));

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
      ...accounts
        .slice(1)
        .map((id) =>
          database
            .insert(credentials)
            .values({ id, publicKey: hexToBytes(id), account: id, factory: inject("ExaAccountFactory") }),
        ),
      ...accounts.map((address) => anvilClient.setBalance({ address, value: parseEther("5") })),
      keeper.writeContract({
        address: inject("ExaAccountFactory"),
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(owners[0].address), y: 0n }]],
      }),
    ]);

    const waitForTransactionReceipt = vi.spyOn(publicClient, "waitForTransactionReceipt");
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
      vi.waitUntil(() => waitForTransactionReceipt.mock.settledResults.length >= 5, 16_666),
    ]);

    expect(response.status).toBe(200);
  });
});

const activityPayload = {
  header: undefined,
  json: {
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "OPT_SEPOLIA",
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
      ],
    },
  },
} as const;

vi.mock("@sentry/node", { spy: true });

afterEach(() => vi.resetAllMocks());
