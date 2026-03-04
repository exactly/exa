import "../mocks/deployments";
import "../mocks/redis";
import "../mocks/sentry";

import { parse } from "valibot";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import redis from "../../utils/redis";

import type * as accounts from "../../utils/accounts";
import type * as nonceManagerModule from "../../utils/nonceManager";
import type refunderModule from "../../utils/refunder";

const credentialsKey = `refunder-${chain.id}`;
const teamName = "Exa Labs - Base Sepolia";
const validNonce = "aBcDeFgH12345678";

const exaSend = vi.fn().mockResolvedValue({});
const testAccount = privateKeyToAccount(generatePrivateKey());

vi.mock("../../utils/accounts", async (importOriginal) => {
  const original = await importOriginal<typeof accounts>();
  return {
    ...original,
    getAccount: vi.fn().mockResolvedValue(testAccount),
    withExaSend: vi.fn((): { exaSend: typeof exaSend } => ({ exaSend })),
  };
});

vi.mock("../../utils/nonceManager", async (importOriginal) => {
  const original = await importOriginal<typeof nonceManagerModule>();
  return { ...original, default: original.createNonceManager({ source: { get: () => 0, set: () => undefined } }) };
});

const fetchSpy = vi.spyOn(globalThis, "fetch");

const validWithdrawSignature = {
  status: "ok",
  signature: { data: "0xabc", salt: "0xdef" },
  expiresAt: "1700000000",
  sender: testAccount.address,
  chainId: `0x${chain.id.toString(16)}`,
  parameters: [
    testAccount.address,
    "0x10b5Be494C2962A7B318aFB63f0Ee30b959D000b",
    "1000000",
    testAccount.address,
    1_700_000_000,
    [1, 2, 3],
    "0xsig",
  ] as [string, string, string, string, number, number[], string],
};

function mockNonce(nonce = validNonce) {
  return Response.json({ nonce }, { status: 200, headers: { "set-cookie": "sessionId=abc123; Path=/" } });
}

function mockTeams(name = teamName) {
  return Response.json({ teams: [{ userId: "user123", name }] }, { status: 200 });
}

function mockAuth(token = "bearertoken", teamId = "team123") {
  return Response.json({ token, user: { teamId } }, { status: 200 });
}

function mockProfile(csrfToken = "csrftoken", teamId = "team123") {
  return Response.json({ csrfToken, user: { teamId } }, { status: 200 });
}

function mockWithdraw() {
  return Response.json(validWithdrawSignature, { status: 200 });
}

function mockFreshSignIn() {
  fetchSpy
    .mockResolvedValueOnce(mockNonce())
    .mockResolvedValueOnce(mockTeams())
    .mockResolvedValueOnce(mockAuth())
    .mockResolvedValueOnce(mockProfile());
}

function mockUrlRouter() {
  fetchSpy.mockImplementation((input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
    if (url.includes("get-teams")) return Promise.resolve(mockTeams());
    if (url.includes("verify-sign-in-message")) return Promise.resolve(mockAuth());
    if (url.includes("/me")) return Promise.resolve(mockProfile());
    if (url.includes("collateral/signature/withdraw")) return Promise.resolve(mockWithdraw());
    return Promise.resolve(new Response("not found", { status: 404 }));
  });
}

let refunder: typeof refunderModule;

beforeAll(async () => {
  mockFreshSignIn();
  const module = await import("../../utils/refunder");
  refunder = module.default;
  const client = await refunder();
  expect(client.withdraw).toBeDefined();
});

beforeEach(() => {
  fetchSpy.mockReset();
  exaSend.mockReset().mockResolvedValue({});
});

afterEach(async () => {
  await redis.del(credentialsKey);
});

describe("credential management", () => {
  it("stores credentials in redis", async () => {
    mockUrlRouter();
    const client = await refunder();
    await client.withdraw(1_000_000n, parse(Address, testAccount.address));
    expect(JSON.parse((await redis.get(credentialsKey))!)).toMatchObject({
      teamId: "team123",
      headers: expect.objectContaining({ "x-csrf-token": "csrftoken" }) as unknown,
    });
  });

  it("uses cached credentials when profile check returns 401", async () => {
    await redis.set(
      credentialsKey,
      JSON.stringify({ teamId: "old", headers: { Cookie: "old", Authorization: "old", "x-csrf-token": "old" } }),
    );
    fetchSpy.mockResolvedValueOnce(new Response("", { status: 401 })).mockResolvedValueOnce(mockWithdraw());
    const client = await refunder();
    await client.withdraw(1_000_000n, parse(Address, testAccount.address));
    expect(exaSend).toHaveBeenCalledOnce();
    expect(JSON.parse((await redis.get(credentialsKey))!)).toMatchObject({ teamId: "old" });
  });
});

describe("withdrawal", () => {
  it("succeeds with valid signature", async () => {
    await redis.set(
      credentialsKey,
      JSON.stringify({
        teamId: "team123",
        headers: { Cookie: "c", Authorization: "Bearer t", "x-csrf-token": "csrf" },
      }),
    );
    fetchSpy.mockResolvedValueOnce(mockProfile()).mockResolvedValueOnce(mockWithdraw());
    const client = await refunder();
    await client.withdraw(1_000_000n, parse(Address, testAccount.address));
    expect(exaSend).toHaveBeenCalledOnce();
    expect(exaSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ name: "panda.withdraw", op: "panda.withdraw" }),
      expect.objectContaining({ functionName: "withdrawAsset" }),
    );
  });

  it("propagates withdraw signature failure", async () => {
    await redis.set(
      credentialsKey,
      JSON.stringify({
        teamId: "team123",
        headers: { Cookie: "c", Authorization: "Bearer t", "x-csrf-token": "csrf" },
      }),
    );
    fetchSpy.mockResolvedValueOnce(mockProfile()).mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "withdraw signature failed",
    );
    expect(exaSend).not.toHaveBeenCalled();
  });

  it("propagates error when re-auth and retry both fail", async () => {
    fetchSpy.mockImplementation(() => Promise.resolve(new Response("unauthorized", { status: 401 })));
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow();
    expect(exaSend).not.toHaveBeenCalled();
  });

  it("propagates invalid withdraw signature response", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ invalid: true }, { status: 200 }));
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow();
    expect(exaSend).not.toHaveBeenCalled();
  });

  it("propagates panda api error on withdraw", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("collateral/signature/withdraw"))
        return Promise.resolve(new Response("server error", { status: 500 }));
      if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
      if (url.includes("get-teams")) return Promise.resolve(mockTeams());
      if (url.includes("verify-sign-in-message")) return Promise.resolve(mockAuth());
      if (url.includes("/me")) return Promise.resolve(mockProfile());
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "withdraw signature failed",
    );
    expect(exaSend).not.toHaveBeenCalled();
  });
});

describe("sign-in flow", () => {
  it("uses cached credentials when profile is valid", async () => {
    await redis.set(
      credentialsKey,
      JSON.stringify({
        teamId: "cached",
        headers: { Cookie: "cachedcookie", Authorization: "Bearer cached", "x-csrf-token": "cachedcsrf" },
      }),
    );
    fetchSpy.mockResolvedValueOnce(mockProfile("restoredcsrf")).mockResolvedValueOnce(mockWithdraw());
    const client = await refunder();
    await client.withdraw(1_000_000n, parse(Address, testAccount.address));
    expect(exaSend).toHaveBeenCalledOnce();
  });

  it("propagates error when cached credentials are expired", async () => {
    await redis.set(
      credentialsKey,
      JSON.stringify({
        teamId: "expired",
        headers: { Cookie: "old", Authorization: "Bearer old", "x-csrf-token": "old" },
      }),
    );
    fetchSpy
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }))
      .mockResolvedValueOnce(new Response("unauthorized", { status: 401 }));
    const client = await refunder();
    await expect(client.withdraw(1_000_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "withdraw signature failed",
    );
    expect(exaSend).not.toHaveBeenCalled();
  });

  it("throws when team is not found", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
      if (url.includes("get-teams"))
        return Promise.resolve(Response.json({ teams: [{ userId: "u", name: "Wrong" }] }, { status: 200 }));
      if (url.includes("/me")) return Promise.resolve(new Response("", { status: 401 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      `team "${teamName}" not found`,
    );
  });

  it("throws when nonce fetch fails", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(new Response("bad gateway", { status: 502 }));
      if (url.includes("/me")) return Promise.resolve(new Response("", { status: 401 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "nonce fetch failed: 502",
    );
  });

  it("throws when no session cookie received", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(Response.json({ nonce: validNonce }, { status: 200 }));
      if (url.includes("/me")) return Promise.resolve(new Response("", { status: 401 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "no session cookie received",
    );
  });

  it("throws when authenticate fails", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
      if (url.includes("get-teams")) return Promise.resolve(mockTeams());
      if (url.includes("verify-sign-in-message")) return Promise.resolve(new Response("forbidden", { status: 403 }));
      if (url.includes("/me")) return Promise.resolve(new Response("", { status: 401 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "authenticate failed: 403",
    );
  });

  it("throws when profile fetch fails after authentication", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
      if (url.includes("get-teams")) return Promise.resolve(mockTeams());
      if (url.includes("verify-sign-in-message")) return Promise.resolve(mockAuth());
      if (url.includes("/me")) return Promise.resolve(new Response("", { status: 200 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(500_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "authentication succeeded but profile fetch failed",
    );
  });

  it("throws when profile returns non-ok status during sign-in", async () => {
    fetchSpy.mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.includes("generate-nonce")) return Promise.resolve(mockNonce());
      if (url.includes("get-teams")) return Promise.resolve(mockTeams());
      if (url.includes("verify-sign-in-message")) return Promise.resolve(mockAuth());
      if (url.includes("/me")) return Promise.resolve(new Response("error", { status: 500 }));
      return Promise.resolve(new Response("not found", { status: 404 }));
    });
    const client = await refunder();
    await expect(client.withdraw(1_000_000n, parse(Address, testAccount.address))).rejects.toThrow(
      "authentication succeeded but profile fetch failed",
    );
    expect(exaSend).not.toHaveBeenCalled();
  });
});
