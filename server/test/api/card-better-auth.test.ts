import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/onesignal";
import "../mocks/pax";
import "../mocks/persona";
import "../mocks/sardine";
import "../mocks/sentry";

import { parse } from "valibot";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";
import { Address } from "@exactly/common/validation";

import app from "../../api/card";
import database, { cards, credentials, users, walletAddresses } from "../../database";
import auth from "../../utils/auth";
import * as panda from "../../utils/panda";

const credential = parse(Address, "0x0000000000000000000000000000000000000789");

describe("card better auth", () => {
  beforeAll(async () => {
    await database.insert(users).values({
      id: "card-better-auth-user",
      name: "Better Auth",
      email: "card-better-auth@example.com",
    });
    await database.insert(walletAddresses).values({
      id: "card-better-auth-wallet",
      userId: "card-better-auth-user",
      address: credential,
      chainId: chain.id,
      isPrimary: true,
      createdAt: new Date(),
    });
    await database.insert(credentials).values({
      id: credential,
      publicKey: new Uint8Array(),
      account: parse(Address, "0x0000000000000000000000000000000000000790"),
      factory: parse(Address, inject("ExaAccountFactory")),
      pandaId: "card-better-auth",
    });
    await database.insert(cards).values({
      id: "card-better-auth-card",
      credentialId: credential,
      lastFour: "7890",
    });
  });

  afterEach(() => vi.restoreAllMocks());

  it("returns card secrets with sessionid", async () => {
    vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
      session: {
        activeOrganizationId: null,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60_000),
        id: "card-better-auth-session",
        ipAddress: null,
        token: "card-better-auth-token",
        updatedAt: new Date(),
        userAgent: null,
        userId: "card-better-auth-user",
      },
      user: {
        createdAt: new Date(),
        email: "card-better-auth@example.com",
        emailVerified: false,
        id: "card-better-auth-user",
        image: null,
        name: "Better Auth",
        updatedAt: new Date(),
      },
    } satisfies NonNullable<Awaited<ReturnType<typeof auth.api.getSession>>>);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce({
      expirationMonth: "11",
      expirationYear: "2031",
      id: "card-better-auth-card",
      last4: "7890",
      limit: { amount: 7000, frequency: "per24HourPeriod" },
      status: "active",
      type: "virtual",
      userId: "card-better-auth",
    });
    vi.spyOn(panda, "getUser").mockResolvedValueOnce({
      applicationReason: "test",
      applicationStatus: "approved",
      email: "better@example.com",
      firstName: "Better",
      id: "card-better-auth",
      isActive: true,
      lastName: "Auth",
      phoneCountryCode: "US",
      phoneNumber: "5551234567",
    });
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce({
      encryptedPan: {
        data: "pan",
        iv: "pan-iv",
      },
      encryptedCvc: {
        data: "cvc",
        iv: "cvc-iv",
      },
    });
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce({
      pin: {
        data: "pin",
        iv: "pin-iv",
      },
    });

    const response = await app.request("/", {
      headers: {
        sessionid: "fakeSession",
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({
      displayName: "Better Auth",
      encryptedCvc: {
        data: "cvc",
        iv: "cvc-iv",
      },
      encryptedPan: {
        data: "pan",
        iv: "pan-iv",
      },
      expirationMonth: "11",
      expirationYear: "2031",
      lastFour: "7890",
      limit: {
        amount: 7000,
        frequency: "per24HourPeriod",
      },
      mode: 0,
      productId: PLATINUM_PRODUCT_ID,
      provider: "panda",
      pin: {
        data: "pin",
        iv: "pin-iv",
      },
      status: "ACTIVE",
    });
    expect(panda.getSecrets).toHaveBeenCalledExactlyOnceWith("card-better-auth-card", "fakeSession");
    expect(panda.getPIN).toHaveBeenCalledExactlyOnceWith("card-better-auth-card", "fakeSession");
  });
});
