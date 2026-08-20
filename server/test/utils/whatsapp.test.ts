import { afterEach, describe, expect, it, vi } from "vitest";

import createWhatsapp from "../../utils/whatsapp";

const whatsapp = createWhatsapp({ from: "sender", token: "whatsapp" });

describe("whatsapp", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sends a whatsapp text message", async () => {
    const response = new Response("{}");
    const request = vi.spyOn(globalThis, "fetch").mockResolvedValue(response);

    await whatsapp.send("5491123456789", "hello");

    expect(response.bodyUsed).toBe(true);
    expect(request).toHaveBeenCalledExactlyOnceWith("https://graph.facebook.com/v26.0/sender/messages", {
      method: "POST",
      headers: { authorization: "Bearer whatsapp", accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        recipient: "5491123456789",
        type: "text",
        text: { body: "hello" },
      }),
      signal: expect.anything() as AbortSignal,
    });
  });

  it("rejects a whatsapp error response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("forbidden", { status: 403 }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "forbidden", name: "WhatsApp403", status: 403 },
      message: "forbidden",
      name: "UnrecoverableError",
    });
  });

  it.each([500, 503])("retries a %s response", async (status) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("temporary", { status }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      message: "temporary",
      name: `WhatsApp${status}`,
      status,
    });
  });

  it("retries a transient graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        { error: { is_transient: true, message: "rate limit hit", type: "OAuthException" } },
        { status: 429 },
      ),
    );

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      message: "rate limit hit",
      name: "WhatsAppOAuthException",
      status: 429,
    });
  });

  it("does not retry a permanent graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({ error: { message: "message undeliverable", type: "OAuthException" } }, { status: 400 }),
    );

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "message undeliverable", name: "WhatsAppOAuthException", status: 400 },
      message: "message undeliverable",
      name: "UnrecoverableError",
    });
  });

  it("does not retry an unknown graph error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 400 }));

    await expect(whatsapp.send("5491123456789", "hello")).rejects.toMatchObject({
      cause: { message: "400", name: "WhatsApp400", status: 400 },
      message: "400",
      name: "UnrecoverableError",
    });
  });
});
