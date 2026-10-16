import "../mocks/auth";
import "../mocks/panda";
import "../mocks/sentry";

import { captureException, setUser } from "@sentry/node";
import { HTTPException } from "hono/http-exception";
import { testClient } from "hono/testing";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { padHex } from "viem";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { PLATINUM_PRODUCT_ID, SIGNATURE_PRODUCT_ID } from "@exactly/common/panda";

import route from "../../api/cards";
import database, { cards, credentials } from "../../database";
import authenticate from "../../middleware/auth";
import createPanda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

const panda = createPanda({
  key: parse(pipe(string(), nonEmpty()), env.PANDA_API_KEY),
  url: parse(pipe(string(), nonEmpty()), env.PANDA_API_URL),
});
const appClient = testClient(route({ auth: authenticate(""), database, panda }));

describe("authenticated", () => {
  beforeAll(async () => {
    const publicKey = new Uint8Array();
    const factory = exaAccountFactoryAddress;
    await database.insert(credentials).values([
      { id: "cards", publicKey, factory, account: padHex("0xca7d1", { size: 20 }), pandaId: "cards" },
      { id: "cards-empty", publicKey, factory, account: padHex("0xca7d2", { size: 20 }), pandaId: "cards-empty" },
      { id: "cards-no-panda", publicKey, factory, account: padHex("0xca7d3", { size: 20 }) },
      { id: "cards-frozen", publicKey, factory, account: padHex("0xca7d4", { size: 20 }), pandaId: "cards-frozen" },
    ]);
    await database.insert(cards).values([
      { id: second, credentialId: "cards", lastFour: "2222", status: "FROZEN", mode: 3 },
      { id: first, credentialId: "cards", lastFour: "1111", productId: SIGNATURE_PRODUCT_ID },
      { id: third, credentialId: "cards", lastFour: "3333", status: "DELETED" },
      { id: "ca7d0000-0000-4000-8000-000000000005", credentialId: "cards-no-panda", lastFour: "5555" },
      { id: "ca7d0000-0000-4000-8000-000000000006", credentialId: "cards-frozen", lastFour: "6666", status: "FROZEN" },
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

  it("omits cards that fail to load", async () => {
    const error = new ServiceError("Panda", 500, "internal error");
    vi.spyOn(panda, "getCard").mockRejectedValueOnce(error);

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards" } });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual([
      { ...profile, lastFour: "2222", mode: 3, status: "FROZEN", productId: PLATINUM_PRODUCT_ID },
      { ...profile, lastFour: "3333", mode: 0, status: "DELETED", productId: PLATINUM_PRODUCT_ID },
    ]);
    expect(panda.getCard).toHaveBeenCalledTimes(3);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      extra: { cardId: first, credentialId: "cards" },
    });
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
    vi.spyOn(panda, "getUser").mockRejectedValue(new ServiceError("Panda", 404, "", "NotFoundError"));

    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "cards-frozen" } });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "no panda" });
    expect(panda.getCard).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(
      expect.any(ServiceError),
      expect.objectContaining({ level: "warning", fingerprint: ["{{ default }}", "PandaNotFound"] }),
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
