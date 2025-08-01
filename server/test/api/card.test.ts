import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAbi, exaPluginAbi } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { zeroHash, padHex, zeroAddress, hexToBigInt, parseEther } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/card";
import database, { cards, credentials } from "../../database";
import keeper from "../../utils/keeper";
import * as panda from "../../utils/panda";
import publicClient from "../../utils/publicClient";

const appClient = testClient(app);

describe("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });
  const ownerETH = privateKeyToAddress(padHex("0xbeef"));
  const ethAccount = deriveAddress(inject("ExaAccountFactory"), { x: padHex(ownerETH), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(),
        account,
        factory: zeroAddress,
        pandaId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b66",
      },
      {
        id: ethAccount,
        publicKey: new Uint8Array(),
        account: ethAccount,
        factory: zeroAddress,
        pandaId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b77",
      },
    ]);
    await publicClient.waitForTransactionReceipt({
      hash: await keeper.writeContract({
        address: inject("ExaAccountFactory"),
        abi: exaAccountFactoryAbi,
        functionName: "createAccount",
        args: [0n, [{ x: hexToBigInt(ownerETH), y: 0n }]],
      }),
      confirmations: 0,
    });

    await publicClient.waitForTransactionReceipt({
      hash: await keeper.writeContract({
        address: inject("WETH"),
        abi: [{ type: "function", name: "mint", inputs: [{ type: "address" }, { type: "uint256" }] }],
        functionName: "mint",
        args: [ethAccount, parseEther("1")],
      }),
      confirmations: 0,
    });
    await publicClient.waitForTransactionReceipt({
      hash: await keeper.writeContract({
        address: ethAccount,
        abi: exaPluginAbi,
        functionName: "poke",
        args: [inject("MarketWETH")],
      }),
      confirmations: 0,
    });
  });

  afterEach(async () => {
    await database.delete(cards).where(eq(cards.credentialId, account));
    vi.restoreAllMocks();
  });

  it("returns 404 card not found", async () => {
    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": account } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({
      code: "no card",
      legacy: "card not found",
    });
  });

  it("returns 404 card not found when card is deleted", async () => {
    await database
      .insert(cards)
      .values([
        { id: "543c1771-beae-4f26-b662-44ea48b40dc6", credentialId: account, lastFour: "1234", status: "DELETED" },
      ]);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": account } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({
      code: "no card",
      legacy: "card not found",
    });
  });

  it("returns panda card as default platinum product", async () => {
    await database
      .insert(cards)
      .values([{ id: "543c1771-beae-4f26-b662-44ea48b40dc6", credentialId: account, lastFour: "1234" }]);
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

    vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": account } },
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
    await database.insert(cards).values([
      {
        id: "543c1771-beae-4f26-b662-44ea48b40dc6",
        credentialId: account,
        lastFour: "1234",
        productId: SIGNATURE_PRODUCT_ID,
      },
    ]);
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

    vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": account } },
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
        factory: zeroAddress,
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

    const response = await appClient.index.$post({ header: { "test-credential-id": account } });
    const json = await response.json();

    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, account),
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

    const response = await appClient.index.$post({ header: { "test-credential-id": ethAccount } });
    const json = await response.json();

    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, ethAccount),
    });

    expect(created?.mode).toBe(1);

    expect(json).toStrictEqual({
      status: "ACTIVE",
      lastFour: "1224",
      productId: SIGNATURE_PRODUCT_ID,
    });
  });

  it("cancels a card", async () => {
    const cardResponse = { ...cardTemplate, id: "cardForCancel", last4: "1224", status: "active" as const };
    vi.spyOn(panda, "createCard").mockResolvedValueOnce(cardResponse);
    vi.spyOn(panda, "updateCard").mockResolvedValueOnce({ ...cardResponse, status: "canceled" });

    const response = await appClient.index.$post({ header: { "test-credential-id": ethAccount } });

    const cancelResponse = await appClient.index.$patch({
      // @ts-expect-error - bad hono patch type
      header: { "test-credential-id": ethAccount },
      json: { status: "DELETED" },
    });

    expect(response.status).toBe(200);
    expect(cancelResponse.status).toBe(200);

    const card = await database.query.cards.findFirst({
      columns: { status: true },
      where: eq(cards.credentialId, ethAccount),
    });

    expect(card?.status).toBe("DELETED");
  });

  describe("migration", () => {
    it("creates a panda card having a cm card with upgraded plugin", async () => {
      await database.insert(cards).values([{ id: "cm", credentialId: account, lastFour: "1234" }]);

      vi.spyOn(panda, "getCard").mockRejectedValueOnce(new Error("404 card not found"));
      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "migration:cm" });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({ header: { "test-credential-id": account } });

      const created = await database.query.cards.findFirst({ where: eq(cards.id, "migration:cm") });
      const deleted = await database.query.cards.findFirst({ where: eq(cards.id, "cm") });

      expect(response.status).toBe(200);
      expect(created?.status).toBe("ACTIVE");
      expect(deleted?.status).toBe("DELETED");
    });

    it("creates a panda card having a cm card with invalid uuid", async () => {
      await database.insert(cards).values([{ id: "not-uuid", credentialId: account, lastFour: "1234" }]);

      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "migration:not-uuid" });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({ header: { "test-credential-id": account } });

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
  id: "543c1771-beae-4f26-b662-44ea48b40dc6",
  last4: "7394",
  limit: { amount: 5000, frequency: "per24HourPeriod" },
  status: "active",
  type: "virtual",
  userId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b66",
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
  id: "543c1771-beae-4f26-b662-44ea48b40dc6",
  isActive: true,
  lastName: "Last",
  phoneCountryCode: "AR",
  phoneNumber: "1234567890",
} as const;
