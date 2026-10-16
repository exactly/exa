import "../mocks/auth";
import "../mocks/panda";
import * as segment from "../mocks/segment";
import "../mocks/sentry";

import { captureException, setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { testClient } from "hono/testing";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { getAddress, padHex } from "viem";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

import route from "../../api/cards";
import database, { cards, credentials } from "../../database";
import authenticate from "../../middleware/auth";
import createPanda from "../../utils/panda";
import createSegment from "../../utils/segment";
import ServiceError from "../../utils/ServiceError";

import type * as C from "@exactly/common/generated/chain";

const panda = createPanda({
  key: parse(pipe(string(), nonEmpty()), env.PANDA_API_KEY),
  url: parse(pipe(string(), nonEmpty()), env.PANDA_API_URL),
});
const appClient = testClient(
  route({
    auth: authenticate(""),
    database,
    panda,
    segment: createSegment(parse(pipe(string(), nonEmpty()), env.SEGMENT_WRITE_KEY)),
  }),
);

describe("authenticated", () => {
  beforeAll(async () => {
    const publicKey = new Uint8Array();
    const factory = exaAccountFactoryAddress;
    await database.insert(credentials).values([
      { id: "cards", publicKey, factory, account: padHex("0xca7d1", { size: 20 }), pandaId: "cards" },
      { id: "cards-empty", publicKey, factory, account: padHex("0xca7d2", { size: 20 }), pandaId: "cards-empty" },
      { id: "cards-no-panda", publicKey, factory, account: padHex("0xca7d3", { size: 20 }) },
      { id: "cards-frozen", publicKey, factory, account: padHex("0xca7d4", { size: 20 }), pandaId: "cards-frozen" },
      { id: "cards-canceled", publicKey, factory, account: padHex("0xca7da", { size: 20 }), pandaId: "cards-canceled" },
      { id: "cards-tenants", publicKey, factory, account: padHex("0xca7db", { size: 20 }), pandaId: "cards-tenants" },
      { id: "cards-legacy", publicKey, factory, account: padHex("0xca7dc", { size: 20 }), pandaId: "cards-legacy" },
      { id: "cards-raced", publicKey, factory, account: padHex("0xca7dd", { size: 20 }), pandaId: "cards-raced" },
    ]);
    await database.insert(cards).values([
      { id: second, credentialId: "cards", tenant: "OP", lastFour: "2222", status: "FROZEN", mode: 3 },
      { id: first, credentialId: "cards", tenant: "OP", lastFour: "1111", productId: SIGNATURE_PRODUCT_ID },
      { id: third, credentialId: "cards", tenant: "OP", lastFour: "3333", status: "DELETED" },
      { id: "ca7d0000-0000-4000-8000-000000000005", credentialId: "cards-no-panda", tenant: "OP", lastFour: "5555" },
      {
        id: "ca7d0000-0000-4000-8000-000000000006",
        credentialId: "cards-frozen",
        tenant: "OP",
        lastFour: "6666",
        status: "FROZEN",
      },
      { id: canceled, credentialId: "cards-canceled", tenant: "OP", lastFour: "1212" },
      { id: retired, credentialId: "cards-canceled", tenant: "OP", lastFour: "1515", status: "DELETED" },
      { id: tenants[0].card, credentialId: "cards-tenants", tenant: "OP", lastFour: "1313" },
      { id: tenants[1].card, credentialId: "cards-tenants", tenant: "BASE", lastFour: "1414" },
      { id: "legacy", credentialId: "cards-legacy", tenant: "OP", lastFour: "1616" },
      { id: current, credentialId: "cards-legacy", tenant: "OP", lastFour: "1717" },
      { id: raced, credentialId: "cards-raced", tenant: "OP", lastFour: "1818" },
    ]);
  });

  beforeEach(() => {
    vi.spyOn(panda, "getCard").mockImplementation((id) => Promise.resolve({ ...cardTemplate, id }));
    vi.spyOn(panda, "getUser").mockResolvedValue(userTemplate);
  });

  afterEach(() => vi.resetAllMocks());

  it("returns card profiles of active, frozen, and deleted cards sorted by id", async () => {
    const getSecrets = vi.spyOn(panda, "getSecrets");
    const getPIN = vi.spyOn(panda, "getPIN");
    const getProcessorDetails = vi.spyOn(panda, "getProcessorDetails");
    const getNonce = vi.spyOn(panda, "getNonce");

    const response = await appClient.index.$get(
      {},
      { headers: { "test-credential-id": "cards", sessionid: "session" } },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "1111", mode: 0, status: "ACTIVE", productId: SIGNATURE_PRODUCT_ID },
      { ...profile, lastFour: "2222", mode: 3, status: "FROZEN", productId: PLATINUM_PRODUCT_ID },
      { ...profile, lastFour: "3333", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getUser).toHaveBeenCalledExactlyOnceWith("cards");
    expect(getSecrets).not.toHaveBeenCalled();
    expect(getPIN).not.toHaveBeenCalled();
    expect(getProcessorDetails).not.toHaveBeenCalled();
    expect(getNonce).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("omits deleted cards that fail to load", async () => {
    const error = new ServiceError("Panda", 500, "internal error");
    vi.spyOn(panda, "getCard").mockImplementation((id) =>
      id === third ? Promise.reject(error) : Promise.resolve({ ...cardTemplate, id }),
    );

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "1111", mode: 0, status: "ACTIVE", productId: SIGNATURE_PRODUCT_ID },
      { ...profile, lastFour: "2222", mode: 3, status: "FROZEN", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getCard).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      extra: { cardId: third, credentialId: "cards" },
    });
  });

  it.each([
    ["active", first],
    ["frozen", second],
  ])("fails when the %s card fails to load", async (_, cardId) => {
    vi.spyOn(panda, "getCard").mockImplementation((id) =>
      id === cardId
        ? Promise.reject(new ServiceError("Panda", 500, "internal error"))
        : Promise.resolve({ ...cardTemplate, id }),
    );

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(500);
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns each card with its holder name", async () => {
    vi.spyOn(panda, "getCard").mockImplementation((id) =>
      Promise.resolve({ ...cardTemplate, id, userId: id === first ? "holder" : "cards" }),
    );
    vi.spyOn(panda, "getUser").mockImplementation((id) =>
      Promise.resolve(id === "holder" ? { ...userTemplate, id, firstName: "Card", lastName: "Holder" } : userTemplate),
    );

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      {
        ...profile,
        displayName: "Card Holder",
        lastFour: "1111",
        mode: 0,
        status: "ACTIVE",
        productId: SIGNATURE_PRODUCT_ID,
      },
      { ...profile, lastFour: "2222", mode: 3, status: "FROZEN", productId: PLATINUM_PRODUCT_ID },
      { ...profile, lastFour: "3333", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getUser).toHaveBeenCalledTimes(2);
    expect(panda.getUser).toHaveBeenCalledWith("cards");
    expect(panda.getUser).toHaveBeenCalledWith("holder");
  });

  it("retires cards that the provider canceled", async () => {
    vi.spyOn(panda, "getCard").mockImplementation((id) => Promise.resolve({ ...cardTemplate, id, status: "canceled" }));
    const update = vi.spyOn(database, "update");

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-canceled" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "1212", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
      { ...profile, lastFour: "1515", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(update).toHaveBeenCalledOnce();
    expect(segment.track).toHaveBeenCalledExactlyOnceWith({
      userId: getAddress(padHex("0xca7da", { size: 20 })),
      event: "CardDeleted",
      properties: { cardId: canceled, source: null },
    });
    await expect(
      database.query.cards.findFirst({ columns: { status: true }, where: eq(cards.id, canceled) }),
    ).resolves.toStrictEqual({ status: "DELETED" });
  });

  it("tracks no deletion when the canceled card is deleted while listing", async () => {
    vi.spyOn(panda, "getCard").mockImplementation(async (id) => {
      await database.update(cards).set({ status: "DELETED" }).where(eq(cards.id, id));
      return { ...cardTemplate, id, status: "canceled" };
    });

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-raced" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "1818", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(segment.track).not.toHaveBeenCalled();
  });

  it.each(tenants)("returns only $own cards", async ({ isBase, card, lastFour }) => {
    mocks.isBase.mockReturnValue(isBase);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-tenants" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour, mode: 0, status: "ACTIVE", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getCard).toHaveBeenCalledExactlyOnceWith(card);
  });

  it("skips legacy cards", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-legacy" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "1717", mode: 0, status: "ACTIVE", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getCard).toHaveBeenCalledExactlyOnceWith(current);
  });

  it("returns empty list when user has no cards", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-empty" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([]);
    expect(panda.getUser).not.toHaveBeenCalled();
  });

  it("returns 500 no credential when credential does not exist", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-missing" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ code: "no credential" });
    expect(panda.getUser).not.toHaveBeenCalled();
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(setUser).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("returns 403 no panda when credential has no panda id", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-no-panda" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
  });

  it("returns 403 no panda and captures when panda user is not found", async () => {
    const error = new ServiceError("Panda", 404, "", "NotFoundError");
    vi.spyOn(panda, "getUser").mockRejectedValue(error);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-frozen" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      error,
      expect.objectContaining({
        level: "warning",
        fingerprint: ["{{ default }}", "PandaNotFound"],
        extra: {
          cardIds: ["ca7d0000-0000-4000-8000-000000000006"],
          credentialId: "cards-frozen",
          pandaId: "cards-frozen",
          statuses: ["FROZEN"],
          userIssue: "PandaNotFound",
        },
      }),
    );
  });

  it("returns 403 no panda and captures when user with active card is not approved", async () => {
    vi.spyOn(panda, "getUser").mockRejectedValue(notApproved);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      notApproved,
      expect.objectContaining({
        level: "warning",
        fingerprint: ["{{ default }}", "PandaForbidden"],
        extra: {
          cardIds: [first, second, third],
          credentialId: "cards",
          pandaId: "cards",
          statuses: ["ACTIVE", "FROZEN", "DELETED"],
          userIssue: "PandaForbidden",
        },
      }),
    );
  });

  it("returns 403 no panda without capture when user with frozen cards is not approved", async () => {
    vi.spyOn(panda, "getUser").mockRejectedValue(notApproved);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-frozen" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws when getUser fails with an unexpected error", async () => {
    vi.spyOn(panda, "getUser").mockRejectedValue(new HTTPException(500, { message: "unexpected panda failure" }));

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(500);
  });

  it("throws when getUser fails with a provider error", async () => {
    vi.spyOn(panda, "getUser").mockRejectedValue(new ServiceError("Panda", 500, "internal error"));

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(500);
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", new ServiceError("Panda", 404, "", "GoneError")],
    ["unapproved", new ServiceError("Panda", 403, "", "DeniedError", "user not approved")],
  ])("throws when the %s panda user has an unknown error name", async (_, error) => {
    vi.spyOn(panda, "getUser").mockRejectedValue(error);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(500);
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("throws when panda user is forbidden for another reason", async () => {
    vi.spyOn(panda, "getUser").mockRejectedValue(
      new ServiceError("Panda", 403, '{"message":"Forbidden","error":"ForbiddenError"}', "ForbiddenError", "Forbidden"),
    );

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(500);
    expect(captureException).not.toHaveBeenCalled();
  });
});

const first = "ca7d0000-0000-4000-8000-000000000001";
const second = "ca7d0000-0000-4000-8000-000000000002";
const third = "ca7d0000-0000-4000-8000-000000000003";
const canceled = "ca7d0000-0000-4000-8000-000000000011";
const retired = "ca7d0000-0000-4000-8000-000000000014";
const current = "ca7d0000-0000-4000-8000-000000000015";
const raced = "ca7d0000-0000-4000-8000-000000000016";
const tenants = [
  { isBase: false, own: "OP", card: "ca7d0000-0000-4000-8000-000000000012", lastFour: "1313" },
  { isBase: true, own: "BASE", card: "ca7d0000-0000-4000-8000-000000000013", lastFour: "1414" },
] as const;

const cardTemplate = {
  expirationMonth: "9",
  expirationYear: "2029",
  last4: "7394",
  limit: { amount: 5000, frequency: "per24HourPeriod" },
  status: "active",
  type: "virtual",
  userId: "cards",
} as const;

const userTemplate = {
  applicationReason: "test",
  applicationStatus: "approved",
  email: "email@example.com",
  firstName: "First",
  id: "cards",
  isActive: true,
  lastName: "Last",
  phoneCountryCode: "AR",
  phoneNumber: "1234567890",
} as const;

const profile = {
  displayName: "First Last",
  expirationMonth: "9",
  expirationYear: "2029",
  limit: { amount: 5000, frequency: "per24HourPeriod" },
};

const notApproved = new ServiceError(
  "Panda",
  403,
  '{"message":"User exists but is not approved yet","error":"ForbiddenError","statusCode":403}',
  "ForbiddenError",
  "User exists but is not approved yet",
);

const mocks = vi.hoisted(() => ({ isBase: vi.fn<(base: boolean) => boolean>() }));
vi.mock("@exactly/common/generated/chain", async (importOriginal) => {
  const original = await importOriginal<typeof C>();
  return {
    ...original,
    get isBase() {
      return mocks.isBase(original.isBase);
    },
  };
});

beforeEach(() => {
  mocks.isBase.mockReset().mockImplementation((value) => value);
});
