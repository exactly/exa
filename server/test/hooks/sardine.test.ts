import "../mocks/sentry";

import { captureEvent, captureException, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, startSpan } from "@sentry/node";
import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import createSardineHook from "../../hooks/sardine";

const webhookSecret = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const { app } = createSardineHook({ webhookSecret });

describe("sardine hook", () => {
  it("rejects a bad signature", async () => {
    const response = await deliver({ id: "event", type: "case.created", data: {} }, "00");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
    expect(captureEvent).not.toHaveBeenCalled();
    expect(setContext).not.toHaveBeenCalledWith("sardine", expect.anything());
  });

  it("rejects a missing signature", async () => {
    const response = await app.request("/", {
      method: "POST",
      body: "{}",
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toStrictEqual({ code: "unauthorized" });
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["an event without id", { type: "alert.created", data: {} }],
    ["a case without id", { type: "case.created", data: { caseDetails: { id: 1 } } }],
    ["a malformed case", { id: "event", type: "case.updated", data: { caseDetails: { id: "case" } } }],
  ])("captures %s", async (_, payload) => {
    const response = await deliver(payload);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ code: "bad sardine" });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("bad sardine"), {
      fingerprint: ["{{ default }}", "bad sardine"],
      contexts: { validation: expect.objectContaining({ success: false }) as unknown },
    });
    expect(captureEvent).not.toHaveBeenCalled();
  });

  it.each(["case.created", "case.updated"])("reports %s without acting", async (type) => {
    const response = await deliver({
      id: "event",
      type,
      data: { caseDetails: { id: 12_345, decision: "declined", linkedCustomers: ["credential"] } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setContext).toHaveBeenCalledWith("sardine", { id: "event", type });
    expect(captureEvent).toHaveBeenCalledOnce();
    const [event] = vi.mocked(captureEvent).mock.calls[0] ?? [];
    expect(event).toMatchObject({ message: `sardine ${type}`, level: "warning" });
    expect(event?.contexts?.sardine).toStrictEqual({ case: 12_345, decision: "declined", customers: ["credential"] });
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each(["alert.created", "aml_screening_update.alerts"])("reports %s", async (type) => {
    const response = await deliver({ id: "event", type, data: {} });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setContext).toHaveBeenCalledWith("sardine", { id: "event", type });
    expect(captureEvent).toHaveBeenCalledOnce();
    expect(vi.mocked(captureEvent).mock.calls[0]?.[0]).toMatchObject({ message: `sardine ${type}`, level: "warning" });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("acknowledges other events", async () => {
    const response = await deliver({ id: "event", type: "alert.updated", data: {} });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setContext).toHaveBeenCalledWith("sardine", { id: "event", type: "alert.updated" });
    expect(captureEvent).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("names the active span after the event", async () => {
    const op = await startSpan({ name: "sardine", op: "http.server" }, async (span) => {
      const setAttribute = vi.spyOn(span, "setAttribute");
      const response = await deliver({ id: "event", type: "alert.created", data: {} });
      expect(response.status).toBe(200);
      return setAttribute.mock.calls.find(([key]) => key === SEMANTIC_ATTRIBUTE_SENTRY_OP)?.[1];
    });

    expect(op).toBe("sardine.alert.created");
  });
});

function deliver(payload: object, signature?: string) {
  const body = JSON.stringify(payload);
  return app.request("/", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-sardine-signature": signature ?? createHmac("sha256", webhookSecret).update(body).digest("hex"),
    },
  });
}

vi.mock("@sentry/node", { spy: true });
