import { eq, inArray } from "drizzle-orm";
import { testClient } from "hono/testing";
import { serializeSigned } from "hono/utils/cookie";
import { zeroAddress } from "viem";
import { afterEach, assert, beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../api/chat";
import database, { credentials } from "../../database";
import authSecret from "../../utils/authSecret";
import * as chat from "../../utils/chat";
import redis from "../../utils/redis";

const client = testClient(app);
const me = "chat-me";
const other = "chat-other";

describe("chat", () => {
  beforeEach(async () => {
    await database.insert(credentials).values([
      {
        id: me,
        publicKey: new Uint8Array(),
        account: "0x00000000000000000000000000000000000000a1",
        factory: zeroAddress,
      },
      {
        id: other,
        publicKey: new Uint8Array(),
        account: "0x00000000000000000000000000000000000000a2",
        factory: zeroAddress,
      },
    ]);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    const keys = await redis.keys("chat:*");
    if (keys.length > 0) await redis.del(...keys);
    await database.delete(credentials).where(inArray(credentials.id, [me, other]));
  });

  it("reports available when the wa id is free", async () => {
    const token = await chat.encode("5491100000001");
    const response = await client.index.$get({ query: { token } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "available" });
  });

  it("reports available when already associated with the same wa id", async () => {
    await database.update(credentials).set({ waId: "5491100000002" }).where(eq(credentials.id, me));
    const token = await chat.encode("5491100000002");
    const response = await client.index.$get({ query: { token } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "available" });
  });

  it("reports wa taken when associated with another credential", async () => {
    await database.update(credentials).set({ waId: "5491100000003" }).where(eq(credentials.id, other));
    const token = await chat.encode("5491100000003");
    const response = await client.index.$get({ query: { token } }, { headers: await headers() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "wa taken" });
  });

  it("reports wa associated when the credential already has a different wa id", async () => {
    await database.update(credentials).set({ waId: "5491100000004" }).where(eq(credentials.id, me));
    const token = await chat.encode("5491100000005");
    const response = await client.index.$get({ query: { token } }, { headers: await headers() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "wa associated" });
  });

  it("rejects a bad token on preflight", async () => {
    const response = await client.index.$get({ query: { token: "not-a-token" } }, { headers: await headers() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad token" });
  });

  it("requires authentication", async () => {
    const response = await client.index.$get({ query: { token: "x" } });

    expect(response.status).toBe(401);
  });

  it("sends a validation code", async () => {
    const spy = vi.spyOn(chat, "sendCode");
    const token = await chat.encode("5491100000006");
    const response = await client.code.$post({ json: { token } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "sent" });
    const pending = await redis.get(`chat:${me}`);
    assert(pending);
    const { waId, code } = JSON.parse(pending) as { code: string; waId: string };
    expect(waId).toBe("5491100000006");
    expect(code).toMatch(/^\d{6}$/);
    expect(spy).toHaveBeenCalledExactlyOnceWith("5491100000006", code);
  });

  it("rejects a bad token when sending", async () => {
    const spy = vi.spyOn(chat, "sendCode");
    const response = await client.code.$post({ json: { token: "not-a-token" } }, { headers: await headers() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad token" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("rate limits repeated sends to the same wa id", async () => {
    const token = await chat.encode("5491100000012");
    const first = await client.code.$post({ json: { token } }, { headers: await headers() });
    const second = await client.code.$post({ json: { token } }, { headers: await headers() });

    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toStrictEqual({ code: "too soon" });
  });

  it("associates an empty credential after verification", async () => {
    const code = await request("5491100000007");
    const response = await client.index.$post({ json: { code } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ waId: "5491100000007" });
    await expect(waIdOf(me)).resolves.toBe("5491100000007");
    await expect(redis.exists(`chat:${me}`)).resolves.toBe(0);
  });

  it("overrides an existing wa id", async () => {
    await database.update(credentials).set({ waId: "5491100000008" }).where(eq(credentials.id, me));
    const code = await request("5491100000009");
    const response = await client.index.$post({ json: { code } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(waIdOf(me)).resolves.toBe("5491100000009");
  });

  it("steals the wa id and nulls the other credential", async () => {
    await database.update(credentials).set({ waId: "5491100000010" }).where(eq(credentials.id, other));
    const code = await request("5491100000010");
    const response = await client.index.$post({ json: { code } }, { headers: await headers() });

    expect(response.status).toBe(200);
    await expect(waIdOf(me)).resolves.toBe("5491100000010");
    await expect(waIdOf(other)).resolves.toBeNull();
  });

  it("rejects a wrong code", async () => {
    const code = await request("5491100000011");
    const response = await client.index.$post(
      { json: { code: code === "000000" ? "111111" : "000000" } },
      { headers: await headers() },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "bad code" });
    await expect(waIdOf(me)).resolves.toBeNull();
    await expect(redis.exists(`chat:${me}`)).resolves.toBe(0);
  });

  it("rejects when there is no pending verification", async () => {
    const response = await client.index.$post({ json: { code: "123456" } }, { headers: await headers() });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toStrictEqual({ code: "no verification" });
  });
});

async function headers(credentialId = me) {
  return { cookie: await serializeSigned("credential_id", credentialId, authSecret) };
}

async function request(waId: string) {
  const token = await chat.encode(waId);
  await client.code.$post({ json: { token } }, { headers: await headers() });
  const pending = await redis.get(`chat:${me}`);
  assert(pending);
  return (JSON.parse(pending) as { code: string }).code;
}

async function waIdOf(credentialId: string) {
  const credential = await database.query.credentials.findFirst({
    columns: { waId: true },
    where: eq(credentials.id, credentialId),
  });
  return credential?.waId ?? null;
}
