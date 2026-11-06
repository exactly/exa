import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { Queue } from "bullmq";
import { createHmac } from "node:crypto";
import { parse, string } from "valibot";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import createChatHook from "../../hooks/chat";
import { connect } from "../../workers/worker";

import type { MockInstance } from "vitest";

let redis: ReturnType<typeof connect>;
let chatHook: ReturnType<typeof createChatHook>;
let add: MockInstance<Queue["add"]>;

describe("chat hook", () => {
  afterEach(async () => {
    await chatHook.close();
    await redis.quit();
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    redis = connect(parse(string(), process.env.REDIS_URL));
    add = vi.spyOn(Queue.prototype, "add");
    chatHook = createChatHook({
      redis,
      whatsappSecret: "hmac",
      whatsappFrom: "321",
      whatsappVerifyToken: "verify",
    });
    await chatHook.ready;
  });

  it("echoes the challenge to a valid verification", async () => {
    const response = await chatHook.app.request("/?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=1337");
    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toBe("1337");
  });

  it("rejects a verification with an invalid verify token", async () => {
    const response = await chatHook.app.request("/?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1337");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid verify token" });
  });

  it("rejects an incomplete verification", async () => {
    const response = await chatHook.app.request("/?hub.mode=unsubscribe&hub.verify_token=verify");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "bad verification" });
  });

  it("rejects an invalid signature", async () => {
    const response = await chatHook.app.request("/", {
      method: "POST",
      body: JSON.stringify(message()),
      headers: { "X-Hub-Signature-256": "sha256=bad" },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
    expect(add).not.toHaveBeenCalled();
  });

  it("rejects an incorrect signature of the expected length", async () => {
    const response = await chatHook.app.request("/", {
      method: "POST",
      body: JSON.stringify(message()),
      headers: { "X-Hub-Signature-256": `sha256=${"0".repeat(64)}` },
    });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
  });

  it("rejects a missing signature", async () => {
    const response = await chatHook.app.request("/", { method: "POST", body: JSON.stringify(message()) });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
  });

  it("rejects a missing signature with an empty secret", async () => {
    const emptyHook = createChatHook({ redis, whatsappFrom: "321", whatsappSecret: "" });
    try {
      const response = await emptyHook.app.request("/", { method: "POST", body: JSON.stringify(message()) });
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toStrictEqual({ code: "invalid signature" });
      expect(add).not.toHaveBeenCalled();
    } finally {
      await emptyHook.close();
    }
  });

  it("rejects invalid json", async () => {
    const response = await request("nope");
    expect(response.status).toBe(400);
  });

  it("rejects an unknown payload", async () => {
    const response = await request(JSON.stringify({}));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "bad chat" });
    expect(add).not.toHaveBeenCalled();
  });

  it("enqueues a message", async () => {
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(add).toHaveBeenCalledExactlyOnceWith(
      ...enqueued({
        contact: "John",
        from: "US.12345678",
        id: "whatsapp-1",
        text: "Hi!",
      }),
    );
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores a message delivered to another business number", async () => {
    const response = await request(JSON.stringify(message("999")));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(add).not.toHaveBeenCalled();
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("chat delivered to another business number"), {
      level: "error",
      extra: { expected: "321", foreign: ["999"] },
    });
  });

  it("ignores a status event without messages", async () => {
    const response = await request(
      JSON.stringify({
        entry: [
          {
            changes: [
              {
                value: { metadata: { phone_number_id: "321" }, statuses: [{ id: "whatsapp-1", status: "delivered" }] },
              },
            ],
          },
        ],
      }),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(add).not.toHaveBeenCalled();
  });

  it("ignores a message without text", async () => {
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
    expect(add).not.toHaveBeenCalled();
  });

  it("merges a sender batch into a single job", async () => {
    const response = await request(
      JSON.stringify(
        message(
          "321",
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
          { id: "whatsapp-2", from: "US.12345678", text: "How are you?" },
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(add).toHaveBeenCalledExactlyOnceWith(
      ...enqueued({
        contact: "John",
        from: "US.12345678",
        id: "whatsapp-1",
        text: "Hi!\nHow are you?",
      }),
    );
  });

  it("groups a batch by sender and drops duplicate message ids", async () => {
    const response = await request(
      JSON.stringify(
        message(
          "321",
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
          { id: "whatsapp-2", from: "US.87654321", text: "Hola!" }, // cspell:ignore Hola
          { id: "whatsapp-1", from: "US.12345678", text: "Hi!" },
        ),
      ),
    );
    expect(response.status).toBe(200);
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith(
      ...enqueued({
        contact: "John",
        from: "US.12345678",
        id: "whatsapp-1",
        text: "Hi!",
      }),
    );
    expect(add).toHaveBeenCalledWith(
      ...enqueued({
        contact: undefined,
        from: "US.87654321",
        id: "whatsapp-2",
        text: "Hola!", // cspell:ignore Hola
      }),
    );
  });

  it("captures and propagates queue failures", async () => {
    const error = new Error("queue down");
    add.mockRejectedValueOnce(error);
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      extra: { sender: { id: "whatsapp-1", from: "US.12345678", text: "Hi!", contact: "John", phoneNumberId: "321" } },
      tags: { job: "chat", queue: "chat" },
    });
  });

  it("captures redis errors instead of crashing", async () => {
    await redis.ping();
    redis.emit("error", new Error("socket closed"));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("socket closed"));
  });
});

function message(phoneNumberId = "321", ...messages: { from: string; id: string; text: string }[]) {
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
              metadata: { display_phone_number: "1555", phone_number_id: phoneNumberId },
              contacts: [{ profile: { name: "John" }, user_id: "US.12345678" }],
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

function enqueued({ id, ...data }: { contact: string | undefined; from: string; id: string; text: string }) {
  return [
    "chat",
    { ...data, sentryBaggage: expect.any(String) as string, sentryTrace: expect.any(String) as string },
    { jobId: id },
  ] as const;
}

function request(body: string, headers?: Record<string, string>) {
  return chatHook.app.request("/", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "X-Hub-Signature-256": `sha256=${createHmac("sha256", "hmac").update(body).digest("hex")}`,
      ...headers,
    },
  });
}
