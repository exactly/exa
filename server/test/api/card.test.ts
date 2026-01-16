import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/sentry";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { hexToBigInt, padHex, parseEther, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, exaPluginAbi } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

import app from "../../api/card";
import database, { cards, credentials } from "../../database";
import keeper from "../../utils/keeper";
import * as panda from "../../utils/panda";

const appClient = testClient(app);

describe("authenticated", () => {
  beforeAll(async () => {
    const owner = privateKeyToAddress(padHex("0xbeef"));
    const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(owner), y: zeroHash });
    const publicKey = new Uint8Array();
    await database.insert(credentials).values([
      { id: "eth", publicKey, account, factory: inject("ExaAccountFactory"), pandaId: "eth" },
      {
        id: "default",
        publicKey,
        account: padHex("0x1", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "default",
      },
      {
        id: "sig",
        publicKey,
        account: padHex("0x2", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "sig",
      },
      {
        id: "404",
        publicKey,
        account: padHex("0x3", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "404",
      },
    ]);
    await database.insert(cards).values([
      { id: "default", credentialId: "default", lastFour: "1234" },
      { id: "sig", credentialId: "sig", lastFour: "1234", productId: SIGNATURE_PRODUCT_ID },
      { id: "404", credentialId: "404", lastFour: "1234", status: "DELETED" },
    ]);

    await Promise.all([
      keeper.exaSend(
        { name: "create account", op: "exa.account" },
        {
          address: inject("ExaAccountFactory"),
          abi: exaAccountFactoryAbi,
          functionName: "createAccount",
          args: [0n, [{ x: hexToBigInt(owner), y: 0n }]],
        },
      ),
      keeper.exaSend(
        { name: "mint weth", op: "exa.weth" },
        { address: inject("WETH"), abi: mockERC20Abi, functionName: "mint", args: [account, parseEther("1")] },
      ),
    ]);
    await keeper.exaSend(
      { name: "poke", op: "exa.poke" },
      { address: account, abi: exaPluginAbi, functionName: "poke", args: [inject("MarketWETH")] },
    );
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns 404 card not found", async () => {
    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "404" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({ code: "no card", legacy: "card not found" });
  });

  it("returns 404 card not found when card is deleted", async () => {
    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "404" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({ code: "no card", legacy: "card not found" });
  });

  it("returns panda card as default platinum product", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

    vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toStrictEqual({
      ...panTemplate,
      ...pinTemplate,
      displayName: "First Last",
      expirationMonth: "9",
      expirationYear: "2029",
      lastFour: "1234",
      mode: 0,
      provider: "panda",
      status: "ACTIVE",
      limit: { amount: 5000, frequency: "per24HourPeriod" },
      productId: PLATINUM_PRODUCT_ID,
    });
  });

  it("returns panda card with signature product id", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

    vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "sig" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toStrictEqual({
      ...panTemplate,
      ...pinTemplate,
      displayName: "First Last",
      expirationMonth: "9",
      expirationYear: "2029",
      lastFour: "1234",
      mode: 0,
      provider: "panda",
      status: "ACTIVE",
      limit: { amount: 5000, frequency: "per24HourPeriod" },
      productId: SIGNATURE_PRODUCT_ID,
    });
  });

  it("returns 403 no panda when no panda customer", async () => {
    const foo = deriveAddress(inject("ExaAccountFactory"), {
      x: padHex(privateKeyToAddress(padHex("0xf00"))),
      y: zeroHash,
    });

    await database.insert(credentials).values([
      {
        id: foo,
        publicKey: new Uint8Array(),
        account: foo,
        factory: inject("ExaAccountFactory"),
      },
    ]);
    await database.insert(cards).values([{ id: `card-${foo}`, credentialId: foo, lastFour: "4567" }]);

    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": foo } },
    );

    expect(response.status).toBe(403);
  });

  it("creates a panda debit card with signature product id", async () => {
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "createCard" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "sig" } });
    const json = await response.json();

    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, "sig"),
    });

    expect(created?.mode).toBe(0);
    expect(json).toStrictEqual({
      status: "ACTIVE",
      lastFour: "7394",
      productId: SIGNATURE_PRODUCT_ID,
    });
  });

  it("creates a panda credit card with signature product id", async () => {
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "createCreditCard", last4: "1224" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "eth" } });
    const json = await response.json();

    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, "eth"),
    });

    expect(created?.mode).toBe(1);

    expect(json).toStrictEqual({ status: "ACTIVE", lastFour: "1224", productId: SIGNATURE_PRODUCT_ID });
  });

  it("cancels a card", async () => {
    const cardResponse = { ...cardTemplate, id: "cardForCancel", last4: "1224", status: "active" as const };
    vi.spyOn(panda, "createCard").mockResolvedValueOnce(cardResponse);
    vi.spyOn(panda, "updateCard").mockResolvedValueOnce({ ...cardResponse, status: "canceled" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "eth" } });

    const cancelResponse = await appClient.index.$patch({
      // @ts-expect-error - bad hono patch type
      header: { "test-credential-id": "eth" },
      json: { status: "DELETED" },
    });

    expect(response.status).toBe(200);
    expect(cancelResponse.status).toBe(200);

    const card = await database.query.cards.findFirst({
      columns: { status: true },
      where: eq(cards.credentialId, "eth"),
    });

    expect(card?.status).toBe("DELETED");
  });

  describe("migration", () => {
    it("creates a panda card having a cm card with upgraded plugin", async () => {
      await database.insert(cards).values([{ id: "cm", credentialId: "default", lastFour: "1234" }]);

      vi.spyOn(panda, "getCard").mockRejectedValueOnce(new Error("404 card not found"));
      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "migration:cm" });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({ header: { "test-credential-id": "default" } });

      const created = await database.query.cards.findFirst({ where: eq(cards.id, "migration:cm") });
      const deleted = await database.query.cards.findFirst({ where: eq(cards.id, "cm") });

      expect(response.status).toBe(200);
      expect(created?.status).toBe("ACTIVE");
      expect(deleted?.status).toBe("DELETED");
    });

    it("creates a panda card having a cm card with invalid uuid", async () => {
      await database.insert(cards).values([{ id: "not-uuid", credentialId: "default", lastFour: "1234" }]);

      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "migration:not-uuid" });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({ header: { "test-credential-id": "default" } });

      const created = await database.query.cards.findFirst({ where: eq(cards.id, "migration:not-uuid") });
      const deleted = await database.query.cards.findFirst({ where: eq(cards.id, "not-uuid") });

      expect(response.status).toBe(200);
      expect(created?.status).toBe("ACTIVE");
      expect(deleted?.status).toBe("DELETED");
    });
  });
});

const cardTemplate = {
  expirationMonth: "9",
  expirationYear: "2029",
  id: "default",
  last4: "7394",
  limit: { amount: 5000, frequency: "per24HourPeriod" },
  status: "active",
  type: "virtual",
  userId: "pandaId",
} as const;

const panTemplate = {
  encryptedCvc: { iv: "TnHuny8FHZ4lkdm1f622Dg==", data: "SRg1oMmouzr7v4FrVBURcWE9Yw==" }, // cspell:ignore TnHuny8FHZ4lkdm1f622Dg SRg1oMmouzr7v4FrVBURcWE9Yw
  encryptedPan: { iv: "xfQikHU/pxVSniCKKKyv8w==", data: "VUPy5u3xdg6fnvT/ZmrE1Lev28SVRjLTTTJEaO9X7is=" },
} as const;

const pinTemplate = {
  pin: { iv: "xfQikHU/pxVSniCKKKyv8w==", data: "VUPy5u3xdg6fnvT/ZmrE1Lev28SVRjLTTTJEaO9X7is=" },
} as const;

const userTemplate = {
  applicationReason: "test",
  applicationStatus: "approved",
  email: "email@example.com",
  firstName: "First",
  id: "default",
  isActive: true,
  lastName: "Last",
  phoneCountryCode: "AR",
  phoneNumber: "1234567890",
} as const;

const mockERC20Abi = [
  {
    type: "function",
    name: "mint",
    inputs: [{ type: "address" }, { type: "uint256" }],
    outputs: [],
    stateMutability: "nonpayable",
  },
] as const;
