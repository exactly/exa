import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/pax";
import "../mocks/persona";

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
import * as pax from "../../utils/pax";
import * as persona from "../../utils/persona";

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
      {
        id: "frozen",
        publicKey,
        account: padHex("0x4", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "frozen",
      },
    ]);
    await database.insert(cards).values([
      { id: "default", credentialId: "default", lastFour: "1234" },
      { id: "sig", credentialId: "sig", lastFour: "1234", productId: SIGNATURE_PRODUCT_ID },
      { id: "404", credentialId: "404", lastFour: "1234", status: "DELETED" },
      { id: "frozen", credentialId: "frozen", lastFour: "5678", status: "FROZEN" },
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

  afterEach(() => vi.resetAllMocks());

  it("returns 404 card not found", async () => {
    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "404" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({ code: "no card" });
  });

  it("returns 404 card not found when card is deleted", async () => {
    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "404" } },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toStrictEqual({ code: "no card" });
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

  it("returns 403 when panda user is not found", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error('404 {"message":"Not Found","error":"NotFoundError","statusCode":404}', {
        cause: { message: "Not Found", status: 404, type: "NotFoundError" },
      }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
  });

  it("returns 403 when panda user is not approved on get", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error('403 {"message":"User exists but is not approved yet","error":"ForbiddenError","statusCode":403}', {
        cause: { message: "User exists but is not approved yet", status: 403, type: "ForbiddenError" },
      }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("returns 403 when panda user is not approved on get with plain text", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error("403 user exists but is not approved", {
        cause: { message: "user exists but is not approved", status: 403, type: "ForbiddenError" },
      }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("returns 403 when panda user is not found on get with empty body", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error("404 ", { cause: { message: "", status: 404, type: "NotFoundError" } }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("throws when panda user is forbidden on get with empty body", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error("403 ", { cause: { message: "", status: 403, type: "ForbiddenError" } }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(500);
  });

  it("returns 403 without capture when frozen card user is not approved on get", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new Error('403 {"message":"User exists, but is not approved","error":"ForbiddenError","statusCode":403}', {
        cause: { message: "User exists, but is not approved", status: 403, type: "ForbiddenError" },
      }),
    );

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "frozen" } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws when getUser fails with non-404 error", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(new Error("500 internal server error"));

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(500);
  });

  it("returns 403 when panda user exists but is not approved", async () => {
    const credentialId = "not-approved";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4040", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () =>
        Promise.resolve('{"message":"User exists, but is not approved","error":"ForbiddenError","statusCode":403}'),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 403 when createCard fails with plain-text not approved", async () => {
    const credentialId = "not-approved-plain";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4043", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve("user exists but is not approved"),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 403 when createCard fails with panda user not found", async () => {
    const credentialId = "panda-user-not-found";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4042", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"User not found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("returns 403 when createCard fails with panda user not found and empty body", async () => {
    const credentialId = "panda-user-not-found-empty";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4044", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve(""),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("captures forbidden no-user on createCard when credential has card history", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () =>
        Promise.resolve('{"message":"User exists, but is not approved","error":"ForbiddenError","statusCode":403}'),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": "404" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(captureException).toHaveBeenCalledOnce();
  });

  it("throws when createCard fails with empty-body 403", async () => {
    const credentialId = "not-approved-empty";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4045", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve(""),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(500);
  });

  it("throws when createCard fails with a different 403 error", async () => {
    const credentialId = "not-approved-different";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4041", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: () => Promise.resolve('{"message":"User is locked","error":"ForbiddenError","statusCode":403}'),
    } as Response);

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(500);
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

  it("adds user to pax when signature card is issued (upgrade from platinum)", async () => {
    const testCredentialId = "pax-test";
    const testAccount = padHex("0x999", { size: 20 });
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      account: testAccount,
      factory: inject("ExaAccountFactory"),
      pandaId: "pax-test-panda",
    });

    await database.insert(cards).values({
      id: "old-platinum-card",
      credentialId: testCredentialId,
      lastFour: "0000",
      status: "DELETED",
      productId: PLATINUM_PRODUCT_ID,
    });

    const deletedCard = await database.query.cards.findFirst({
      where: eq(cards.id, "old-platinum-card"),
    });
    expect(deletedCard?.status).toBe("DELETED");
    expect(deletedCard?.productId).toBe(PLATINUM_PRODUCT_ID);

    const mockAccount = {
      id: "acc_123",
      type: "account" as const,
      attributes: {
        "name-first": "John",
        "name-middle": null,
        "name-last": "Doe",
        birthdate: "1990-01-01",
        "email-address": "john@example.com",
        "phone-number": "+1234567890",
        "country-code": "US",
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "New York",
        "address-subdivision": "NY",
        "address-postal-code": "10001",
        "social-security-number": null,
        fields: {
          name: {
            value: {
              first: { value: "John" },
              middle: { value: null },
              last: { value: "Doe" },
            },
          },
          address: {
            value: {
              street_1: { value: "123 Main St" },
              street_2: { value: null },
              city: { value: "New York" },
              subdivision: { value: "NY" },
              postal_code: { value: "10001" },
            },
          },
          documents: {
            value: [
              {
                value: {
                  id_class: { value: "dl" },
                  id_number: { value: "DOC123456" },
                  id_issuing_country: { value: "US" },
                  id_document_id: { value: "doc_id_123" },
                },
              },
            ],
          },
        },
      },
    };

    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockAccount);
    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "pax-card", last4: "5555" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);

    await vi.waitFor(() => {
      expect(pax.addCapita).toHaveBeenCalledWith({
        firstName: "John",
        lastName: "Doe",
        birthdate: "1990-01-01",
        document: "DOC123456",
        email: "john@example.com",
        phone: "+1234567890",
        internalId: expect.stringMatching(/.+/) as string,
        product: "travel insurance",
      });
    });

    expect(persona.getAccount).toHaveBeenCalledWith(testCredentialId, "basic");
  });

  it("does not add user to pax for new signature card (no upgrade)", async () => {
    const testCredentialId = "new-user-test";
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x888", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: "new-user-panda",
    });

    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({
      ...cardTemplate,
      id: "new-user-card",
      last4: "8888",
    });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toStrictEqual({ status: "ACTIVE", lastFour: "8888", productId: SIGNATURE_PRODUCT_ID });

    expect(pax.addCapita).not.toHaveBeenCalled();
  });

  it("handles pax api error during signature card creation", async () => {
    const testCredentialId = "pax-error-test";
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x777", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: "pax-error-panda",
    });

    await database.insert(cards).values({
      id: "old-platinum-error",
      credentialId: testCredentialId,
      lastFour: "0001",
      status: "DELETED",
      productId: PLATINUM_PRODUCT_ID,
    });

    const mockAccount = {
      id: "acc_456",
      type: "account" as const,
      attributes: {
        "name-first": "Jane",
        "name-middle": null,
        "name-last": "Smith",
        birthdate: "1985-05-15",
        "email-address": "jane@example.com",
        "phone-number": "+9876543210",
        "country-code": "US",
        "address-street-1": "456 Oak Ave",
        "address-street-2": null,
        "address-city": "Boston",
        "address-subdivision": "MA",
        "address-postal-code": "02101",
        "social-security-number": null,
        fields: {
          name: {
            value: {
              first: { value: "Jane" },
              middle: { value: null },
              last: { value: "Smith" },
            },
          },
          address: {
            value: {
              street_1: { value: "456 Oak Ave" },
              street_2: { value: null },
              city: { value: "Boston" },
              subdivision: { value: "MA" },
              postal_code: { value: "02101" },
            },
          },
          documents: {
            value: [
              {
                value: {
                  id_class: { value: "passport" },
                  id_number: { value: "ABC987654" },
                  id_issuing_country: { value: "US" },
                  id_document_id: { value: "doc_id_456" },
                },
              },
            ],
          },
        },
      },
    };

    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockAccount);
    vi.spyOn(pax, "addCapita").mockRejectedValueOnce(new Error("pax api error"));
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "error-card", last4: "6666" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toStrictEqual({ status: "ACTIVE", lastFour: "6666", productId: SIGNATURE_PRODUCT_ID });
  });

  it("handles missing persona account during signature card creation", async () => {
    const testCredentialId = "no-account-test";
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x666", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: "no-account-panda",
    });

    await database.insert(cards).values({
      id: "old-platinum-card-no-account",
      credentialId: testCredentialId,
      lastFour: "0000",
      status: "DELETED",
      productId: PLATINUM_PRODUCT_ID,
    });

    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "no-account-card", last4: "7777" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);

    expect(pax.addCapita).not.toHaveBeenCalled();
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

const { captureException } = vi.hoisted(() => ({ captureException: vi.fn() }));
vi.mock("@sentry/node", async (importOriginal) => {
  const module = await importOriginal();
  if (typeof module !== "object" || module === null) return { captureException };
  return { ...module, captureException };
});
