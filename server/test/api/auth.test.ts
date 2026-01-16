import "../expect";
import "../mocks/redis";
import "../mocks/sentry";

import { Address } from "@exactly/common/validation";
import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import { testClient } from "hono/testing";
import { decodeJwt } from "jose";
import assert from "node:assert";
import { parse, type InferOutput } from "valibot";
import { zeroAddress } from "viem";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app, { type Authentication } from "../../api/auth/authentication";
import database, { credentials } from "../../database";
import type createCredential from "../../utils/createCredential";

const appClient = testClient(app);

describe("authentication", () => {
  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: "dGVzdC1jcmVkLWlk",
        publicKey: new Uint8Array(),
        account: zeroAddress,
        factory: parse(Address, inject("ExaAccountFactory")),
        counter: 0,
        transports: [],
      },
    ]);
  });

  afterEach(() => vi.clearAllMocks());

  it("returns intercom token on successful login", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk",
          rawId: "dGVzdC1jcmVkLWlk",
          response: { clientDataJSON: "dGVzdA", authenticatorData: "dGVzdA", signature: "dGVzdA" },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      { headers: { cookie: "session_id=test-session" } },
    );

    expect(response.status).toBe(200);

    const json = await response.json();
    const authResponse = json as InferOutput<typeof Authentication>;

    assert.ok(authResponse.intercomToken);

    const payload = decodeJwt(authResponse.intercomToken);
    const nowInSeconds = Math.floor(Date.now() / 1000);

    expect(payload.user_id).toBe(zeroAddress);
    expect(payload.sub).toBe(zeroAddress);
    expect(payload.exp).toBeGreaterThan(nowInSeconds + 86_000);
    expect(payload.exp).toBeLessThan(nowInSeconds + 86_500);
  });
});

vi.mock("@simplewebauthn/server", async (importOriginal) => {
  const actual = await importOriginal<typeof SimpleWebAuthn>();
  return {
    ...actual,
    verifyAuthenticationResponse: vi
      .fn<() => Promise<{ verified: boolean; authenticationInfo: { credentialID: string; newCounter: number } }>>()
      .mockResolvedValue({
        verified: true,
        authenticationInfo: { credentialID: "dGVzdC1jcmVkLWlk", newCounter: 1 },
      }),
  };
});

vi.mock("../../utils/redis", () => ({
  default: {
    get: vi.fn<() => string>().mockResolvedValue("test-challenge"),
    set: vi.fn<() => boolean>().mockResolvedValue(true),
    del: vi.fn<() => boolean>().mockResolvedValue(true),
  },
}));

vi.mock("../../utils/createCredential", () => ({
  default: vi.fn<() => ReturnType<typeof createCredential>>().mockResolvedValue({
    credentialId: "dGVzdC1jcmVkLWlk",
    factory: parse(Address, inject("ExaAccountFactory")),
    x: "0x",
    y: "0x",
    auth: Date.now() + 1000,
  }),
}));

vi.mock("@simplewebauthn/server/helpers", async (importOriginal) => {
  const original = await importOriginal<typeof SimpleWebAuthnHelpers>();
  return {
    ...original,
    decodeCredentialPublicKey: vi.fn<() => Map<number, number | Uint8Array>>().mockReturnValue(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(32)], // x
        [-3, new Uint8Array(32)], // y
      ]),
    ),
    cose: { ...original.cose, isCOSEPublicKeyEC2: () => true, COSEKEYS: { x: -2, y: -3 } },
  };
});
