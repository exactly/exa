import "../mocks/sentry";

import { Agent } from "@mastra/core/agent";
import { captureException } from "@sentry/node";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import chat from "../../hooks/chat";

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
    hook = chat({ googleKey: "google", whatsappKey: "kapso", whatsappSecret: "hmac" });
  });

  it("rejects an invalid signature", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate");
    const send = vi.spyOn(globalThis, "fetch");
    const response = await hook.app.request("/", {
      method: "POST",
      body: JSON.stringify(message()),
      headers: { "X-Webhook-Signature": "bad" },
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
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ text: "sure!" } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(generate).toHaveBeenCalledExactlyOnceWith("WhatsApp message from Jhon (+12345678):\n\nHi!"); // cspell:ignore Jhon
    expect(send).toHaveBeenCalledExactlyOnceWith("https://api.kapso.ai/meta/whatsapp/v24.0/321/messages", {
      method: "POST",
      headers: { "X-API-Key": "kapso", "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", to: "12345678", type: "text", text: { body: "sure!" } }),
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("addresses the sender by number without a contact name", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ text: "sure!" } as never);
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const response = await request(JSON.stringify({ message: message().message, phone_number_id: "321" }));
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledExactlyOnceWith("WhatsApp message from 12345678 (+12345678):\n\nHi!");
  });

  it("merges a batch into a single reply", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ text: "sure!" } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const second = message();
    second.message.id = "whatsapp-2";
    second.message.text.body = "How are you?";
    const response = await request(JSON.stringify([message(), second]), { "X-Webhook-Batch": "true" });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledExactlyOnceWith("WhatsApp message from Jhon (+12345678):\n\nHi!\nHow are you?");
    expect(send).toHaveBeenCalledOnce();
  });

  it("groups a batch by sender and drops duplicate whatsapp message ids", async () => {
    const generate = vi.spyOn(Agent.prototype, "generate").mockResolvedValue({ text: "sure!" } as never);
    const send = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response());
    const other = message();
    other.message.id = "whatsapp-2";
    other.message.from = "87654321";
    other.message.text.body = "Hola!";
    const response = await request(JSON.stringify([message(), other, message()]), { "X-Webhook-Batch": "true" });
    expect(response.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledWith("WhatsApp message from Jhon (+12345678):\n\nHi!");
    expect(generate).toHaveBeenCalledWith("WhatsApp message from Jhon (+87654321):\n\nHola!");
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("captures a workflow failure and fails the delivery", async () => {
    vi.spyOn(Agent.prototype, "generate").mockRejectedValue(new Error("llm down"));
    const send = vi.spyOn(globalThis, "fetch");
    const response = await request(JSON.stringify(message()));
    expect(response.status).toBe(500);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("reply workflow failed"), {
      extra: { result: expect.anything() as unknown, from: "12345678" },
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("initializes the sentry exporter with a dsn", async () => {
    vi.stubEnv("SENTRY_DSN", "https://public@sentry.test/1");
    const observed = chat({ googleKey: "google", whatsappKey: "kapso" });
    await expect(observed.ready).resolves.toBeUndefined();
    await expect(observed.close()).resolves.toBeUndefined();
  });
});

function message() {
  return {
    message: { id: "whatsapp-1", from: "12345678", type: "text", text: { body: "Hi!" } },
    conversation: { kapso: { contact_name: "Jhon" } },
    phone_number_id: "321",
  };
}

function request(body: string, headers?: Record<string, string>) {
  return hook.app.request("/", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "X-Webhook-Signature": createHmac("sha256", "hmac").update(body).digest("hex"),
      ...headers,
    },
  });
}
