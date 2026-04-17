import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/keeper";
import "../mocks/pax";
import "../mocks/persona";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { checksumAddress, hexToBigInt, padHex, parseEther, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { parseSiweMessage } from "viem/siwe";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAbi, exaPluginAbi } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

import app from "../../api/card";
import database, { cards, credentials } from "../../database";
import keeper from "../../utils/keeper";
import * as panda from "../../utils/panda";
import * as pax from "../../utils/pax";
import * as persona from "../../utils/persona";
import ServiceError from "../../utils/ServiceError";

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
        id: "debit",
        publicKey,
        account: padHex("0x4", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "debit",
      },
      {
        id: "cancel",
        publicKey,
        account: padHex("0x5", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "cancel",
      },
      {
        id: "migrate-card-upgraded-plugin",
        publicKey,
        account: padHex("0x6", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "migrate",
      },
      {
        id: "migrate-card-non-upgraded-plugin",
        publicKey,
        account: padHex("0x7", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "migrate",
      },
      {
        id: "frozen",
        publicKey,
        account: padHex("0x8", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "frozen",
      },
    ]);
    await database.insert(cards).values([
      { id: "543c1771-beae-4f26-b662-44ea48b40dc6", credentialId: "default", lastFour: "1234" },
      {
        id: "543c1771-beae-4f26-b662-44ea48b40dc7",
        credentialId: "sig",
        lastFour: "1234",
        productId: SIGNATURE_PRODUCT_ID,
      },
      { id: "543c1771-beae-4f26-b662-44ea48b40dc8", credentialId: "404", lastFour: "1234", status: "DELETED" },
      { id: "543c1771-beae-4f26-b662-44ea48b40dc9", credentialId: "frozen", lastFour: "5678", status: "FROZEN" },
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
  beforeEach(() => {
    vi.spyOn(persona, "getCardLimitAccount").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
  });

  it("returns 404 card not found", async () => {
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
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
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);

    vi.spyOn(panda, "getCard").mockResolvedValueOnce({ ...cardTemplate });
    vi.spyOn(panda, "getUser").mockResolvedValueOnce(userTemplate);

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toStrictEqual({
      ...panTemplate,
      ...pinTemplate,
      cardId: "543c1771-beae-4f26-b662-44ea48b40dc6",
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
      cardId: "543c1771-beae-4f26-b662-44ea48b40dc7",
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

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": foo } },
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
  });

  it("returns 403 when panda user is not found", async () => {
    vi.spyOn(panda, "getSecrets").mockResolvedValueOnce(panTemplate);
    vi.spyOn(panda, "getPIN").mockResolvedValueOnce(pinTemplate);
    vi.spyOn(panda, "getCard").mockResolvedValueOnce(cardTemplate);
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(
      new ServiceError(
        "Panda",
        404,
        '{"message":"Not Found","error":"NotFoundError","statusCode":404}',
        "NotFoundError",
        "Not Found",
      ),
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
      new ServiceError(
        "Panda",
        403,
        '{"message":"User exists but is not approved yet","error":"ForbiddenError","statusCode":403}',
        "ForbiddenError",
        "User exists but is not approved yet",
      ),
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
      new ServiceError(
        "Panda",
        403,
        "user exists but is not approved",
        "ForbiddenError",
        "user exists but is not approved",
      ),
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
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(new ServiceError("Panda", 404, "", "NotFoundError"));

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
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(new ServiceError("Panda", 403, "", "ForbiddenError"));

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
      new ServiceError(
        "Panda",
        403,
        '{"message":"User exists, but is not approved","error":"ForbiddenError","statusCode":403}',
        "ForbiddenError",
        "User exists, but is not approved",
      ),
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
    vi.spyOn(panda, "getUser").mockRejectedValueOnce(new ServiceError("Panda", 500, "internal server error"));

    const response = await appClient.index.$get(
      { header: { sessionid: "fakeSession" } },
      { headers: { "test-credential-id": "default" } },
    );

    expect(response.status).toBe(500);
  });

  it("returns 403 when panda user exists but is not approved", async () => {
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "denied" });
    const credentialId = "not-approved";
    await database.insert(credentials).values({
      id: credentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x4040", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: credentialId,
    });

    const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "kyc not approved" });
    expect(captureException).not.toHaveBeenCalled();
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
    const id = "123e4567-e89b-12d3-a456-426655440000";

    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id });
    vi.spyOn(panda, "getCard").mockResolvedValueOnce({ ...cardTemplate, id });
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "debit" } });
    const json = await response.json();

    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, "debit"),
    });

    expect(created?.mode).toBe(0);
    expect(json).toStrictEqual({
      status: "ACTIVE",
      lastFour: "7394",
      cardId: id,
      productId: SIGNATURE_PRODUCT_ID,
    });
  });

  it("creates a panda credit card with signature product id", async () => {
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: "createCreditCard", last4: "1224" });

    const ethCredential = await database.query.credentials.findFirst({
      columns: { account: true },
      where: eq(credentials.id, "eth"),
    });
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "eth" } });
    const json = await response.json();
    expect(response.status).toBe(200);

    const created = await database.query.cards.findFirst({
      columns: { mode: true },
      where: eq(cards.credentialId, "eth"),
    });

    expect(created?.mode).toBe(1);

    expect(json).toStrictEqual({
      status: "ACTIVE",
      lastFour: "1224",
      cardId: "123e4567-e89b-12d3-a456-426655440001",
      productId: SIGNATURE_PRODUCT_ID,
    });
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
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockAccount);
    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({
      ...cardTemplate,
      id: "123e4567-e89b-12d3-a456-426655440016",
      last4: "5555",
    });

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
    const cardId = "123e4567-e89b-12d3-a456-426655440017";
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      account: padHex("0x888", { size: 20 }),
      factory: inject("ExaAccountFactory"),
      pandaId: "new-user-panda",
    });

    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: cardId, last4: "8888" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toStrictEqual({ status: "ACTIVE", lastFour: "8888", cardId, productId: SIGNATURE_PRODUCT_ID });

    expect(pax.addCapita).not.toHaveBeenCalled();
  });

  it("handles pax api error during signature card creation", async () => {
    const testCredentialId = "pax-error-test";
    const cardId = "123e4567-e89b-12d3-a456-426655440018";
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
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
    vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mockAccount);
    vi.spyOn(pax, "addCapita").mockRejectedValueOnce(new Error("pax api error"));
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: cardId, last4: "6666" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json).toStrictEqual({ status: "ACTIVE", lastFour: "6666", cardId, productId: SIGNATURE_PRODUCT_ID });
  });

  it("handles missing persona account during signature card creation", async () => {
    const testCredentialId = "no-account-test";
    const cardId = "123e4567-e89b-12d3-a456-426655440019";

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

    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
    vi.spyOn(pax, "addCapita").mockResolvedValueOnce({});
    vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: cardId, last4: "7777" });

    const response = await appClient.index.$post({ header: { "test-credential-id": testCredentialId } });

    expect(response.status).toBe(200);

    expect(pax.addCapita).not.toHaveBeenCalled();
  });

  it("cancels a card", async () => {
    const id = "123e4567-e89b-12d3-a456-426655440009";
    const cardResponse = { ...cardTemplate, id, last4: "1224", status: "active" as const };
    vi.spyOn(panda, "createCard").mockResolvedValueOnce(cardResponse);
    vi.spyOn(panda, "updateCard").mockResolvedValueOnce({ ...cardResponse, status: "canceled" });
    vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });

    const response = await appClient.index.$post({ header: { "test-credential-id": "cancel" } });

    const cancelResponse = await appClient.index.$patch({
      // @ts-expect-error - bad hono patch type
      header: { "test-credential-id": "cancel" },
      json: { status: "DELETED" },
    });

    expect(response.status).toBe(200);
    expect(cancelResponse.status).toBe(200);

    const card = await database.query.cards.findFirst({ columns: { status: true }, where: eq(cards.id, id) });

    expect(card?.status).toBe("DELETED");
  });

  describe("card limit sync", () => {
    it("passes persona card limit to createCard", async () => {
      const credentialId = "limit-sync-test";
      await database.insert(credentials).values({
        id: credentialId,
        publicKey: new Uint8Array(),
        account: padHex("0xaaa1", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "limit-sync-panda",
      });

      const createCardSpy = vi
        .spyOn(panda, "createCard")
        .mockResolvedValueOnce({ ...cardTemplate, id: "limit-sync-card", last4: "1111" });
      vi.spyOn(persona, "getCardLimitAccount").mockResolvedValueOnce({
        id: "acc_limit",
        type: "account",
        attributes: { fields: { card_limit_usd: { value: 20_000 } } },
      });

      const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

      expect(response.status).toBe(200);
      expect(createCardSpy).toHaveBeenCalledWith("limit-sync-panda", SIGNATURE_PRODUCT_ID, 2_000_000);
    });

    it("uses default limit when persona account has no card limit", async () => {
      const credentialId = "limit-null-test";
      await database.insert(credentials).values({
        id: credentialId,
        publicKey: new Uint8Array(),
        account: padHex("0xaaa2", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "limit-null-panda",
      });

      const createCardSpy = vi
        .spyOn(panda, "createCard")
        .mockResolvedValueOnce({ ...cardTemplate, id: "limit-null-card", last4: "2222" });
      vi.spyOn(persona, "getCardLimitAccount").mockResolvedValueOnce({
        id: "acc_no_limit",
        type: "account",
        attributes: { fields: { card_limit_usd: { value: null } } },
      });

      const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

      expect(response.status).toBe(200);
      expect(createCardSpy).toHaveBeenCalledWith("limit-null-panda", SIGNATURE_PRODUCT_ID, undefined);
    });

    it("falls back to default limit and captures when getCardLimitAccount fails", async () => {
      const credentialId = "limit-fail-test";
      await database.insert(credentials).values({
        id: credentialId,
        publicKey: new Uint8Array(),
        account: padHex("0xaaa3", { size: 20 }),
        factory: inject("ExaAccountFactory"),
        pandaId: "limit-fail-panda",
      });

      const createCardSpy = vi
        .spyOn(panda, "createCard")
        .mockResolvedValueOnce({ ...cardTemplate, id: "limit-fail-card", last4: "3333" });
      const error = new Error("persona api error");
      vi.spyOn(persona, "getCardLimitAccount").mockRejectedValueOnce(error);

      const response = await appClient.index.$post({ header: { "test-credential-id": credentialId } });

      expect(response.status).toBe(200);
      expect(createCardSpy).toHaveBeenCalledWith("limit-fail-panda", SIGNATURE_PRODUCT_ID, undefined);
      expect(captureException).toHaveBeenCalledWith(
        error,
        expect.objectContaining({
          level: "error",
          contexts: { details: { credentialId, scope: "cardLimit" } },
        }),
      );
    });
  });

  describe("signature", () => {
    describe("siwe", () => {
      it("returns a siwe message", async () => {
        const credentialId = privateKeyToAddress(padHex("0xcafe"));
        const account = padHex("0xbbb1", { size: 20 });
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array(),
          account,
          factory: inject("ExaAccountFactory"),
          pandaId: "siwe-ok-panda",
        });
        await database.insert(cards).values({ id: "siwe-ok-card", credentialId, lastFour: "7777" });
        const nonceSpy = vi.spyOn(panda, "getNonce").mockResolvedValueOnce({ nonce: "Db2ItfTPLuZ2dV0ZQ" });

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "siwe", action: "challenge" },
        });

        expect(response.status).toBe(200);
        const body = (await response.json()) as { challenge: string };
        expect(body).toStrictEqual({ challenge: expect.any(String) }); // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        expect(parseSiweMessage(body.challenge)).toStrictEqual({
          domain,
          address: credentialId,
          statement: `I authorize the account ${checksumAddress(account)} to be linked with the card ending in 7777 for my user (siwe-ok-panda)`,
          uri: `https://${domain}`,
          version: "1",
          chainId: chain.id,
          nonce: "Db2ItfTPLuZ2dV0ZQ",
          issuedAt: expect.any(Date), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
        });
        expect(nonceSpy).toHaveBeenCalledWith("siwe-ok-panda");
      });

      it("returns 403 on message when credential has no panda id", async () => {
        const credentialId = privateKeyToAddress(padHex("0xdeadbeef"));
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array(),
          account: padHex("0xbbb2", { size: 20 }),
          factory: inject("ExaAccountFactory"),
        });
        await database.insert(cards).values({ id: "siwe-no-panda-card", credentialId, lastFour: "8888" });
        const nonceSpy = vi.spyOn(panda, "getNonce").mockResolvedValue({ nonce: "unreachable" });

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "siwe", action: "challenge" },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
        expect(nonceSpy).not.toHaveBeenCalled();
      });

      it("verifies the signed message", async () => {
        const credentialId = "siwe-verify-ok";
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array(),
          account: padHex("0xbbc1", { size: 20 }),
          factory: inject("ExaAccountFactory"),
          pandaId: "siwe-verify-panda",
        });
        await database.insert(cards).values({ id: "siwe-verify-card", credentialId, lastFour: "9999" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValueOnce({});
        const message = "I authorize the account 0xabc to be linked with the card ending in 9999 for my user (siwe).";
        const signature = "0x57d2c1f0c01b9173e080bd3cdd40600924cc0c4c31dfe45353d9d967c35d16944a";

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "siwe", action: "verify", message, signature },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({});
        expect(verifySpy).toHaveBeenCalledWith("siwe-verify-panda", { message, signature, authType: "siwe" });
      });

      it("returns 403 on verify when credential has no panda id", async () => {
        const credentialId = "siwe-verify-no-panda";
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array(),
          account: padHex("0xbbc2", { size: 20 }),
          factory: inject("ExaAccountFactory"),
        });
        await database.insert(cards).values({ id: "siwe-verify-no-panda-card", credentialId, lastFour: "1010" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValue({});

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "siwe", action: "verify", message: "unused", signature: "0xdead" },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
        expect(verifySpy).not.toHaveBeenCalled();
      });
    });

    describe("webauthn", () => {
      const assertion = {
        id: "I8d7DPRtg1GZ83as5R9LWw",
        rawId: "I8d7DPRtg1GZ83as5R9LWw",
        response: {
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0", // cspell:ignore eyJ0eXBlIjoid2ViYXV0aG4uZ2V0In0
          authenticatorData: "5d85uxU17437HNUygAfwlrv58UORvl7p-OfSMVnQe64dAAAAAA", // cspell:ignore 5d85uxU17437HNUygAfwlrv58UORvl7p-OfSMVnQe64dAAAAAA
          signature: "MEYCIQD2d5ovtuEXMvfRdJa4JiotIYLnCCR3oEWQRX0xggyfwA",
          userHandle: "cv99bMRjY0w-G2076bDKKTbxiLDpv6_iI19xJRifYzM",
        },
        clientExtensionResults: {},
        type: "public-key" as const,
      };

      it("returns the statement as the challenge", async () => {
        const credentialId = "webauthn-challenge-ok";
        const account = padHex("0xbbd1", { size: 20 });
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([1, 2, 3]),
          account,
          factory: inject("ExaAccountFactory"),
          pandaId: "webauthn-challenge-panda",
        });
        await database.insert(cards).values({ id: "webauthn-challenge-card", credentialId, lastFour: "3377" });
        const nonceSpy = vi.spyOn(panda, "getNonce").mockResolvedValue({ nonce: "unreachable" });

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "webauthn", action: "challenge" },
        });

        const expectedStatement = `I authorize the account ${checksumAddress(account)} to be linked with the card ending in 3377 for my user (webauthn-challenge-panda)`;
        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ challenge: expectedStatement });
        expect(nonceSpy).not.toHaveBeenCalled();
      });

      it("returns 403 on challenge when credential has no panda id", async () => {
        const credentialId = "webauthn-challenge-no-panda";
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([1, 2, 3]),
          account: padHex("0xbbd2", { size: 20 }),
          factory: inject("ExaAccountFactory"),
        });
        await database.insert(cards).values({ id: "webauthn-challenge-no-panda-card", credentialId, lastFour: "4488" });

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "webauthn", action: "challenge" },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
      });

      it("verifies the webauthn assertion", async () => {
        const credentialId = "webauthn-verify-ok";
        const account = padHex("0xbbe1", { size: 20 });
        const factory = inject("ExaAccountFactory");
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([1, 2, 3]),
          account,
          factory,
          pandaId: "webauthn-verify-panda",
          transports: ["internal"],
          counter: 5,
        });
        await database.insert(cards).values({ id: "webauthn-verify-card", credentialId, lastFour: "3377" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValueOnce({});
        const statement = `I authorize the account ${checksumAddress(account)} to be linked with the card ending in 3377 for my user (webauthn-verify-panda)`;

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "webauthn", action: "verify", assertion },
        });

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({});
        expect(verifySpy).toHaveBeenCalledWith("webauthn-verify-panda", {
          authType: "webauthn",
          credential: {
            publicKey: { type: "Buffer", data: [1, 2, 3] },
            transports: ["internal"],
            counter: 5,
          },
          assertion,
          factory,
          statement,
          challenge: statement,
        });
      });

      it("forwards null transports verbatim", async () => {
        const credentialId = "webauthn-verify-null-transports";
        const account = padHex("0xbbe3", { size: 20 });
        const factory = inject("ExaAccountFactory");
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([9, 8, 7]),
          account,
          factory,
          pandaId: "webauthn-null-panda",
          counter: 0,
        });
        await database.insert(cards).values({ id: "webauthn-null-card", credentialId, lastFour: "2020" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValueOnce({});
        const statement = `I authorize the account ${checksumAddress(account)} to be linked with the card ending in 2020 for my user (webauthn-null-panda)`;

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "webauthn", action: "verify", assertion },
        });

        expect(response.status).toBe(200);
        expect(verifySpy).toHaveBeenCalledWith("webauthn-null-panda", {
          authType: "webauthn",
          credential: { publicKey: { type: "Buffer", data: [9, 8, 7] }, transports: null, counter: 0 },
          assertion,
          factory,
          statement,
          challenge: statement,
        });
      });

      it("returns 403 on verify when credential has no panda id", async () => {
        const credentialId = "webauthn-verify-no-panda";
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([1]),
          account: padHex("0xbbe2", { size: 20 }),
          factory: inject("ExaAccountFactory"),
        });
        await database.insert(cards).values({ id: "webauthn-verify-no-panda-card", credentialId, lastFour: "3030" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValue({});

        const response = await appClient.index.$patch({
          // @ts-expect-error - bad hono patch type
          header: { "test-credential-id": credentialId },
          json: { method: "webauthn", action: "verify", assertion },
        });

        expect(response.status).toBe(403);
        await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
        expect(verifySpy).not.toHaveBeenCalled();
      });

      it("rejects unknown webauthn action", async () => {
        const credentialId = "webauthn-bogus";
        await database.insert(credentials).values({
          id: credentialId,
          publicKey: new Uint8Array([1]),
          account: padHex("0xbbe4", { size: 20 }),
          factory: inject("ExaAccountFactory"),
          pandaId: "webauthn-bogus-panda",
        });
        await database.insert(cards).values({ id: "webauthn-bogus-card", credentialId, lastFour: "4040" });
        const verifySpy = vi.spyOn(panda, "verify").mockResolvedValue({});
        const nonceSpy = vi.spyOn(panda, "getNonce").mockResolvedValue({ nonce: "unreachable" });

        const response = await appClient.index.$patch({
          header: { "test-credential-id": credentialId },
          // @ts-expect-error invalid action exercises validator default branch
          json: { method: "webauthn", action: "bogus" },
        });

        expect(response.status).toBe(400);
        expect(verifySpy).not.toHaveBeenCalled();
        expect(nonceSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("migration", () => {
    it("creates a panda card having a cm card with upgraded plugin", async () => {
      const cardId = "cm-not-uuid";
      const migratedCardId = "123e4567-e89b-12d3-a456-426655440003";
      await database
        .insert(cards)
        .values([{ id: cardId, credentialId: "migrate-card-upgraded-plugin", lastFour: "1234" }]);

      vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
      vi.spyOn(panda, "getCard").mockRejectedValueOnce(new ServiceError("Panda", 404, "card not found"));
      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: migratedCardId });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({
        header: { "test-credential-id": "migrate-card-upgraded-plugin" },
      });

      const created = await database.query.cards.findFirst({ where: eq(cards.id, migratedCardId) });
      const deleted = await database.query.cards.findFirst({ where: eq(cards.id, cardId) });

      expect(response.status).toBe(200);
      expect(created?.status).toBe("ACTIVE");
      expect(deleted?.status).toBe("DELETED");
    });

    it("creates a panda card having a cm card with invalid uuid", async () => {
      const migratedCardId = "123e4567-e89b-12d3-a456-426655440005";
      const credentialId = "migrate-card-non-upgraded-plugin";
      await database.insert(cards).values([{ id: "not-uuid", credentialId, lastFour: "1234" }]);

      vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({ id: "pandaId", applicationStatus: "approved" });
      vi.spyOn(panda, "createCard").mockResolvedValueOnce({ ...cardTemplate, id: migratedCardId });
      vi.spyOn(panda, "isPanda").mockResolvedValueOnce(true);

      const response = await appClient.index.$post({
        header: { "test-credential-id": credentialId },
      });

      const created = await database.query.cards.findFirst({ where: eq(cards.id, migratedCardId) });
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
