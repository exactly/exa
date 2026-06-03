import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/onesignal";
import "../mocks/pax";
import "../mocks/persona";
import "../mocks/sardine";
import "../mocks/sentry";

import { parse } from "valibot";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import app from "../../api/card";
import database, { cards, credentials } from "../../database";
import * as panda from "../../utils/panda";
import { createToken } from "../../utils/walletExtension";

describe("card wallet extension", () => {
  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "wallet-extension",
      publicKey: new Uint8Array(),
      account: parse(Address, "0x0000000000000000000000000000000000000456"),
      factory: parse(Address, inject("ExaAccountFactory")),
      pandaId: "wallet-extension",
    });
    await database.insert(cards).values({
      id: "wallet-extension-card",
      credentialId: "wallet-extension",
      lastFour: "4567",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns bearer provisioning without encrypted card fields", async () => {
    vi.spyOn(panda, "getCard").mockResolvedValueOnce({
      expirationMonth: "10",
      expirationYear: "2030",
      id: "wallet-extension-card",
      last4: "4567",
      limit: { amount: 6000, frequency: "per24HourPeriod" },
      status: "active",
      type: "virtual",
      userId: "wallet-extension",
    });
    vi.spyOn(panda, "getUser").mockResolvedValueOnce({
      applicationReason: "test",
      applicationStatus: "approved",
      email: "wallet@example.com",
      firstName: "Wallet",
      id: "wallet-extension",
      isActive: true,
      lastName: "Extension",
      phoneCountryCode: "US",
      phoneNumber: "5551234567",
    });
    vi.spyOn(panda, "getProcessorDetails").mockResolvedValueOnce({
      processorCardId: "proc-wallet-extension",
      timeBasedSecret: "secret-wallet-extension",
    });
    vi.spyOn(panda, "getPIN");
    vi.spyOn(panda, "getSecrets");

    const response = await app.request("/?scope=provisioning", {
      headers: { authorization: `Bearer ${await createToken("wallet-extension", Date.now() + 60_000)}` },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    await expect(response.json()).resolves.toStrictEqual({
      displayName: "Wallet Extension",
      expirationMonth: "10",
      expirationYear: "2030",
      lastFour: "4567",
      limit: { amount: 6000, frequency: "per24HourPeriod" },
      mode: 0,
      productId: PLATINUM_PRODUCT_ID,
      provider: "panda",
      provisioning: { id: "proc-wallet-extension", secret: "secret-wallet-extension" },
      status: "ACTIVE",
    });
    expect(panda.getProcessorDetails).toHaveBeenCalledExactlyOnceWith("wallet-extension-card");
    expect(panda.getPIN).not.toHaveBeenCalled();
    expect(panda.getSecrets).not.toHaveBeenCalled();
  });
});
