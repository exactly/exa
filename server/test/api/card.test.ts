import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";

import deriveAddress from "@exactly/common/deriveAddress";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { zeroHash, padHex, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/card";
import database, { cards, credentials } from "../../database";
import * as kyc from "../../utils/kyc";
import * as panda from "../../utils/panda";

const appClient = testClient(app);

describe("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(),
        account,
        factory: zeroAddress,
        pandaId: "2cf0c886-f7c0-40f3-a8cd-3c4ab3997b66",
      },
    ]);
  });

  afterEach(async () => {
    await database.delete(cards).where(eq(cards.credentialId, account));
    vi.restoreAllMocks();
  });

  it("returns 404 card not found", async () => {
    vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
      id: "pandaId",
      applicationStatus: "approved",
    });
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

  it("returns panda card", async () => {
    await database
      .insert(cards)
      .values([{ id: "543c1771-beae-4f26-b662-44ea48b40dc6", credentialId: account, lastFour: "1234" }]);
    vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
      id: "pandaId",
      applicationStatus: "approved",
    });
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

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

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": foo } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({
      code: "no panda",
      legacy: "no panda",
    });
  });

  it("creates a panda card", async () => {
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "createCard" });
    vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
      id: "pandaId",
      applicationStatus: "approved",
    });

    const response = await appClient.index.$post({ header: { "test-credential-id": account } });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toStrictEqual({
      status: "ACTIVE",
      lastFour: "7394",
    });
  });

  describe("migration", () => {
    it("creates a panda card having a cm card with upgraded plugin", async () => {
      await database.insert(cards).values([{ id: "cm", credentialId: account, lastFour: "1234" }]);

      vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
        id: "pandaId",
        applicationStatus: "approved",
      });
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

      vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
        id: "pandaId",
        applicationStatus: "approved",
      });
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
  encryptedCvc: { iv: "TnHuny8FHZ4lkdm1f622Dg==", data: "SRg1oMmouzr7v4FrVBURcWE9Yw==" }, // cspell:disable-line
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
