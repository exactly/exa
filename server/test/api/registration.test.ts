import "../expect";

import "../mocks/redis";
import customer from "../mocks/sardine";
import "../mocks/sentry";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as derive from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";

import app from "../../api/auth/registration";
import database, { credentials } from "../../database";

import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";

const appClient = testClient(app);

describe("registration", () => {
  afterEach(() => vi.clearAllMocks());

  it("creates a credential with source using webauthn", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567893");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await appClient.index.$post(
      {
        json: {
          id: "dGVzdC1jcmVkLWlk2",
          rawId: "dGVzdC1jcmVkLWlk2",
          response: { clientDataJSON: "dGVzdA", attestationObject: "dGVzdA", transports: ["internal"] },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session", "Client-Fid": "12345" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id: "dGVzdC1jcmVkLWlk2", tags: [{ name: "source", value: "12345", type: "string" }] },
      }),
    );

    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, "dGVzdC1jcmVkLWlk2"),
      columns: { source: true },
    });
    expect(credential?.source).toBe("12345");
  });

  it("creates a credential using webauthn", async () => {
    const account = parse(Address, "0x1234567890123456789012345678901234567892");
    vi.spyOn(derive, "default").mockReturnValue(account);
    const response = await appClient.index.$post(
      {
        json: {
          id: "YW5vdGhlci1jcmVkLWlk2", // cspell:ignore YW5vdGhlci1jcmVkLWlk2
          rawId: "YW5vdGhlci1jcmVkLWlk2",
          response: { clientDataJSON: "dGVzdA", attestationObject: "dGVzdA", transports: ["internal"] },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    expect(customer).toHaveBeenCalledWith(
      expect.objectContaining({
        flow: { name: "signup", type: "signup" },
        customer: { id: "YW5vdGhlci1jcmVkLWlk2", tags: [{ name: "source", value: "EXA", type: "string" }] },
      }),
    );
    const credential = await database.query.credentials.findFirst({
      where: eq(credentials.id, "YW5vdGhlci1jcmVkLWlk2"),
      columns: { source: true },
    });
    expect(credential).toBeDefined();
    expect(credential?.source).toBeNull();
  });
});

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof SimpleWebAuthn>();
  return {
    ...actual,
    verifyRegistrationResponse: vi
      .fn<
        (options: { response: { id: string } }) => Promise<{
          registrationInfo: {
            credential: { counter: number; id: string; publicKey: Uint8Array; transports: string[] };
            credentialDeviceType: string;
          };
          verified: boolean;
        }>
      >()
      .mockImplementation((options: { response: { id: string } }) =>
        Promise.resolve({
          verified: true,
          registrationInfo: {
            credential: {
              id: options.response.id,
              publicKey: new Uint8Array(65),
              counter: 0,
              transports: ["internal"],
            },
            credentialDeviceType: "multiDevice",
          },
        }),
      ),
  };
});

vi.mock("../../utils/redis", () => ({
  default: {
    get: vi.fn<() => string>().mockResolvedValue("test-challenge"),
    set: vi.fn<() => boolean>().mockResolvedValue(true),
    del: vi.fn<() => boolean>().mockResolvedValue(true),
  },
}));

vi.mock("@simplewebauthn/server/helpers", async (importOriginal) => {
  const original = await importOriginal<typeof SimpleWebAuthnHelpers>();
  return {
    ...original,
    decodeCredentialPublicKey: vi.fn<() => Map<number, number | Uint8Array>>().mockReturnValue(
      new Map<number, number | Uint8Array>([
        [1, 2],
        [3, -7],
        [-1, 1],
        [-2, new Uint8Array(32)],
        [-3, new Uint8Array(32)],
      ]),
    ),
    cose: { ...original.cose, isCOSEPublicKeyEC2: () => true, COSEKEYS: { x: -2, y: -3 } },
  };
});
