import "../mocks/sentry";

import { Agent } from "@mastra/core/agent";
import { RedisStore } from "@mastra/redis";
import { captureException } from "@sentry/node";
import { createHmac } from "node:crypto";
import { EventEmitter } from "node:events";
import { parse, string } from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import chat from "../../hooks/chat";

const options = (resource: string, thread: string) =>
  expect.objectContaining({ memory: { resource, thread }, requestContext: expect.anything() as unknown }) as never;

let hook: ReturnType<typeof chat>;

describe("chat hook", () => {
  afterEach(async () => {
    await hook.close();
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", undefined); // eslint-disable-line unicorn/no-useless-undefined
    hook = chat({
      chatKey: "chat",
      anthropicKey: "anthropic",
      postgresUrl: parse(string(), process.env.POSTGRES_URL),
      redisUrl: parse(string(), process.env.REDIS_URL),
      whatsappSecret: "hmac",
      whatsappFrom: "sender",
      whatsappToken: "token",
      whatsappVerifyToken: "verify",
    });
  });

  it("echoes the challenge to a valid verification", async () => {
    const response = await hook.app.request("/?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=1337");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("1337");
  });

  it("rejects a verification with an invalid verify token", async () => {
    const response = await hook.app.request("/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1337");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid verify token" });
  });

  it("rejects an incomplete verification", async () => {
    const response = await hook.app.request("/?hub.mode=unsubscribe&hub.verify_token=verify");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "bad verification" });
  });

  it("rejects an invalid signature", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate");
    const send = vi.spyOn(globalThis, "fetch");
    const response = await hook.app.request("/", {
      method: "POST",
      body: JSON.stringify(message()),
      headers: { "X-Hub-Signature-256": "sha256=bad" },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects a missing signature", async () => {
    const response = await hook.app.request("/", { method: "POST", body: JSON.stringify(message()) });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
  });

  it("rejects invalid json", async () => {
    const response = await request("nope");
    expect(response.status).toBe(400);
  });

  it("rejects an unknown payload", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate");
    const response = await request(JSON.stringify({}));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "bad chat" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("replies to a message", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ steps: [{ text: "sure!" }], toolResults: [] } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!", options("US.12345678", "321/US.12345678"));
    expect(send).toHaveBeenCalledExactlyOnceWith("https://graph.facebook.com/v26.0/sender/messages", {
      method: "POST",
      headers: { authorization: "Bearer token", accept: "application/json", "content-type": "application/json" },
      signal: expect.anything() as AbortSignal,
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        recipient: "US.12345678",
        type: "text",
        text: { body: "sure!" },
      }),
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("addresses the sender without a contact name", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ steps: [{ text: "sure!" }], toolResults: [] } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "321" },
                  messages: [{ id: "whatsapp-1", from_user_id: "US.12345678", type: "text", text: { body: "Hi!" } }],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!", options("US.12345678", "321/US.12345678"));
  });

  it("ignores a status event without messages", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate");
    const send = vi.spyOn(globalThis, "fetch");
    const response = await request(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "321" },
                  statuses: [{ id: "whatsapp-1", status: "delivered" }],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("ignores a message without text", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate");
    const send = vi.spyOn(globalThis, "fetch");
    const response = await request(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: {
                  metadata: { phone_number_id: "321" },
                  messages: [{ id: "whatsapp-1", from_user_id: "US.12345678", type: "image" }],
                },
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    expect(generate).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("merges a batch into a single reply", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ steps: [{ text: "sure!" }], toolResults: [] } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(
      JSON.stringify(
        message(
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
          { id: "whatsapp-2", from: "US.12345678", text: "How are you?" },
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledExactlyOnceWith("Hi!\nHow are you?", options("US.12345678", "321/US.12345678"));
    expect(send).toHaveBeenCalledOnce();
  });

  it("groups a batch by sender and drops duplicate whatsapp message ids", async () => {
    const generate = vi
      .spyOn(Agent.prototype, "generate")
      .mockResolvedValue({ steps: [{ text: "sure!" }], toolResults: [] } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(
      JSON.stringify(
        message(
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
          { id: "whatsapp-2", from: "US.87654321", text: "Hola!" }, // cspell:ignore Hola
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledWith("Hi!", options("US.12345678", "321/US.12345678"));
    expect(generate).toHaveBeenCalledWith("Hola!", options("US.87654321", "321/US.87654321"));
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("captures a generate failure and fails the delivery", async () => {
    vi.spyOn(Agent.prototype, "generate").mockRejectedValue(new Error("llm down"));
    const send = vi.spyOn(globalThis, "fetch");
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("llm down"), {
      // cspell:ignore Jhon
      extra: { sender: { id: "whatsapp-1", from: "US.12345678", text: "Hi!", contact: "Jhon", phoneNumberId: "321" } },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("captures redis client errors instead of crashing", async () => {
    const client = new EventEmitter(); // eslint-disable-line unicorn/prefer-event-target -- mimics node-redis client
    vi.spyOn(RedisStore.prototype, "getClient").mockReturnValue(client as never);
    const observed = chat({
      chatKey: "chat",
      anthropicKey: "anthropic",
      postgresUrl: parse(string(), process.env.POSTGRES_URL),
      redisUrl: parse(string(), process.env.REDIS_URL),
      whatsappFrom: "sender",
      whatsappToken: "token",
    });
    expect(client.emit("error", new Error("socket closed"))).toBe(true);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("socket closed"));
    await observed.close();
  });

  it("initializes the sentry exporter with a dsn", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.test/1");
    const observed = chat({
      chatKey: "chat",
      anthropicKey: "anthropic",
      postgresUrl: parse(string(), process.env.POSTGRES_URL),
      redisUrl: parse(string(), process.env.REDIS_URL),
      whatsappFrom: "sender",
      whatsappToken: "token",
    });
    await expect(observed.ready).resolves.toBeUndefined();
    await expect(observed.close()).resolves.toStrictEqual([undefined, undefined, undefined]);
  });
});

function message(...messages: { from: string; id: string; text: string }[]) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "waba", // cspell:ignore waba
        changes: [
          {
            field: "messages",
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "1555", phone_number_id: "321" },
              // cspell:ignore Jhon
              contacts: [{ profile: { name: "Jhon" }, user_id: "US.12345678" }],
              messages: (messages.length > 0 ? messages : [{ id: "whatsapp-1", from: "US.12345678", text: "Hi!" }]).map(
                ({ id, from, text }) => ({
                  id,
                  from_user_id: from,
                  timestamp: "1",
                  type: "text",
                  text: { body: text },
                }),
              ),
            },
          },
        ],
      },
    ],
  };
}

function request(body: string, headers?: Record<string, string>) {
  return hook.app.request("/", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", "hmac").update(body).digest("hex")}`,
      ...headers,
    },
  });
}
