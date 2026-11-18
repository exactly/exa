import * as segment from "../mocks/segment";
import "../mocks/sentry";

import { captureEvent, captureException, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, startSpan } from "@sentry/node";
import { eq, inArray } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { hexToBytes, padHex, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import database, { cards, credentials } from "../../database";
import createSardineHook from "../../hooks/sardine";
import createSegment from "../../utils/segment";

const webhookSecret = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const { app } = createSardineHook({ database, segment: createSegment("segment"), webhookSecret });

const signer = privateKeyToAddress(generatePrivateKey());
const account = deriveAddress(exaAccountFactoryAddress, { x: padHex(signer), y: zeroHash });
const deletedSigner = privateKeyToAddress(generatePrivateKey());

beforeAll(async () => {
  await database.insert(credentials).values([
    { id: "sardine-case", publicKey: new Uint8Array(hexToBytes(signer)), account, factory: exaAccountFactoryAddress },
    {
      id: "sardine-deleted",
      publicKey: new Uint8Array(hexToBytes(deletedSigner)),
      account: deriveAddress(exaAccountFactoryAddress, { x: padHex(deletedSigner), y: zeroHash }),
      factory: exaAccountFactoryAddress,
    },
  ]);
  await database.insert(cards).values([
    { id: "sardine-case", credentialId: "sardine-case", tenant: "OP", lastFour: "4242" },
    { id: "sardine-deleted", credentialId: "sardine-deleted", tenant: "OP", lastFour: "4243", status: "DELETED" },
  ]);
});

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
      data: { caseDetails: { id: 12_345, decision: "review", linkedCustomers: ["credential"] } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    expect(setContext).toHaveBeenCalledWith("sardine", { id: "event", type });
    expect(captureEvent).toHaveBeenCalledOnce();
    const [event] = vi.mocked(captureEvent).mock.calls[0] ?? [];
    expect(event).toMatchObject({ message: `sardine ${type}`, level: "warning" });
    expect(event?.contexts?.sardine).toStrictEqual({ case: 12_345, decision: "review", customers: ["credential"] });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("holds linked customers on a declined case", async () => {
    const track = vi.spyOn(segment, "track");
    const response = await deliver({
      id: "event",
      type: "case.updated",
      data: {
        caseDetails: { id: 7, decision: "Declined", linkedCustomers: ["sardine-case", "sardine-deleted", "unknown"] },
      },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "held" });
    await expect(
      database.query.cards.findMany({
        columns: { id: true, status: true },
        where: inArray(cards.id, ["sardine-case", "sardine-deleted"]),
        orderBy: cards.id,
      }),
    ).resolves.toStrictEqual([
      { id: "sardine-case", status: "HELD" },
      { id: "sardine-deleted", status: "DELETED" },
    ]);
    expect(track).toHaveBeenCalledExactlyOnceWith({
      userId: account,
      event: "CardHeld",
      properties: { source: null },
    });
  });

  it("releases held cards as frozen on an approved case", async () => {
    await database.update(cards).set({ status: "HELD" }).where(eq(cards.id, "sardine-case"));
    const response = await deliver({
      id: "event",
      type: "case.updated",
      data: { caseDetails: { id: 7, decision: "approve", linkedCustomers: ["sardine-case"] } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "released" });
    await expect(
      database.query.cards.findFirst({ columns: { status: true }, where: eq(cards.id, "sardine-case") }),
    ).resolves.toStrictEqual({ status: "FROZEN" });
  });

  it("ignores an approved case without customers", async () => {
    const response = await deliver({
      id: "event",
      type: "case.updated",
      data: { caseDetails: { id: 8, decision: "approve" } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
  });

  it.each([{ decision: null }, {}])("ignores a case without a decision (%o)", async (verdict) => {
    await database.update(cards).set({ status: "ACTIVE" }).where(eq(cards.id, "sardine-case"));
    const response = await deliver({
      id: "event",
      type: "case.created",
      data: { caseDetails: { id: 9, ...verdict, linkedCustomers: ["sardine-case"] } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
    await expect(
      database.query.cards.findFirst({ columns: { status: true }, where: eq(cards.id, "sardine-case") }),
    ).resolves.toStrictEqual({ status: "ACTIVE" });
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
