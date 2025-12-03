import "../../expect";
import "../../mocks/database";
import "../../mocks/sentry";

import type * as SimpleWebAuthn from "@simplewebauthn/server";
import type * as SimpleWebAuthnHelpers from "@simplewebauthn/server/helpers";
import { testClient } from "hono/testing";
import { decodeJwt } from "jose";
import assert from "node:assert";
import type { Brand, InferOutput } from "valibot";
import { zeroAddress, type Address } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import app, { type Authentication } from "../../../api/auth/authentication";
import database, { credentials } from "../../../database";
import type createCredential from "../../../utils/createCredential";

// Mock dependencies
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

vi.mock("../../../utils/redis", () => ({
  default: {
    get: vi.fn<() => string>().mockResolvedValue("test-challenge"),
    set: vi.fn<() => boolean>().mockResolvedValue(true),
    del: vi.fn<() => boolean>().mockResolvedValue(true),
  },
}));

vi.mock("../../../utils/createCredential", () => ({
  default: vi.fn<() => ReturnType<typeof createCredential>>().mockResolvedValue({
    credentialId: "dGVzdC1jcmVkLWlk",
    factory: zeroAddress as unknown as Address & Brand<"Address">,
    x: "0x",
    y: "0x",
    auth: Date.now() + 1000,
    account: zeroAddress as unknown as Address & Brand<"Address">,
  }),
}));

vi.mock("@simplewebauthn/server/helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof SimpleWebAuthnHelpers>();
  return {
    ...actual,
    decodeCredentialPublicKey: vi.fn<() => Map<number, number | Uint8Array>>().mockReturnValue(
      new Map<number, number | Uint8Array>([
        [1, 2], // kty: EC2
        [3, -7], // alg: ES256
        [-1, 1], // crv: P-256
        [-2, new Uint8Array(32)], // x
        [-3, new Uint8Array(32)], // y
      ]),
    ),
    cose: {
      ...actual.cose,
      isCOSEPublicKeyEC2: () => true,
      COSEKEYS: { x: -2, y: -3 },
    },
  };
});

const appClient = testClient(app);

describe("authentication", () => {
  beforeAll(async () => {
    process.env.AUTH_SECRET = "test-auth-secret";
    await database.insert(credentials).values([
      {
        id: "dGVzdC1jcmVkLWlk",
        publicKey: new Uint8Array(),
        account: zeroAddress,
        factory: zeroAddress,
        counter: 0,
        transports: [],
      },
    ]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns intercomToken on successful login", async () => {
    const response = await appClient.index.$post(
      {
        json: {
          method: "webauthn",
          id: "dGVzdC1jcmVkLWlk", // "test-cred-id" in Base64URL
          rawId: "dGVzdC1jcmVkLWlk",
          response: {
            clientDataJSON: "dGVzdA", // "test"
            authenticatorData: "dGVzdA",
            signature: "dGVzdA",
          },
          clientExtensionResults: {},
          type: "public-key",
        },
      },
      {
        headers: {
          cookie: "session_id=test-session",
        },
      },
    );

    expect(response.status).toBe(200);

    const json = await response.json();
    const authResponse = json as InferOutput<typeof Authentication>;

    assert(authResponse.intercomToken);

    const payload = decodeJwt(authResponse.intercomToken);

    expect(payload.user_id).toBe(zeroAddress);

    expect(payload.sub).toBe(zeroAddress);
    // 24h = 86400 seconds. Allow some leeway for execution time.

    const nowInSeconds = Math.floor(Date.now() / 1000);

    expect(payload.exp).toBeGreaterThan(nowInSeconds + 86_000);
    expect(payload.exp).toBeLessThan(nowInSeconds + 86_500);
  });
});
