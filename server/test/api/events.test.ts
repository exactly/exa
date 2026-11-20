import "../mocks/auth";
import "../mocks/sentry";

import { setUser } from "@sentry/node";
import { testClient } from "hono/testing";
import { parse } from "valibot";
import { padHex } from "viem";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { exaAccountFactoryAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import route from "../../api/events";
import database, { credentials } from "../../database";
import authenticate from "../../middleware/auth";
import { close, emit } from "../../utils/events";

const appClient = testClient(route({ auth: authenticate(""), database }));
const account = parse(Address, padHex("0xe7e471", { size: 20 }));
const other = parse(Address, padHex("0xe7e472", { size: 20 }));

describe("events", () => {
  beforeAll(async () => {
    await database
      .insert(credentials)
      .values([{ id: "events", publicKey: new Uint8Array(), factory: exaAccountFactoryAddress, account }]);
  });

  afterEach(async () => {
    await Promise.all([...readers].map((reader) => reader.cancel()));
    readers.clear();
    vi.useRealTimers();
  });

  it("streams the account events", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "events" } });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    expect(setUser).toHaveBeenCalledWith({ id: account });
    const reader = read(response);
    await expect(reader.next()).resolves.toBe("event: ready\ndata: \n\n");
    emit(other, "card");
    emit(account, "activity");
    emit(account, "proposals");
    await expect(reader.next()).resolves.toBe("event: activity\ndata: \n\n");
    await expect(reader.next()).resolves.toBe("event: proposals\ndata: \n\n");
  });

  it("keeps idle streams alive", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "events" } });
    const reader = read(response);
    await expect(reader.next()).resolves.toBe("event: ready\ndata: \n\n");

    vi.advanceTimersByTime(30_000);

    await expect(reader.next()).resolves.toBe(": \n\n");
  });

  it("stops delivering after the client leaves", async () => {
    const first = await appClient.index.$get({}, { headers: { "test-credential-id": "events" } });
    const second = await appClient.index.$get({}, { headers: { "test-credential-id": "events" } });
    const left = read(first);
    const stayed = read(second);
    await expect(left.next()).resolves.toBe("event: ready\ndata: \n\n");
    await expect(stayed.next()).resolves.toBe("event: ready\ndata: \n\n");

    await left.cancel();
    emit(account, "kyc");

    await expect(stayed.next()).resolves.toBe("event: kyc\ndata: \n\n");
  });

  it("returns 401 without credential", async () => {
    const response = await appClient.index.$get();

    expect(response.status).toBe(401);
  });

  it("fails for unknown credentials", async () => {
    const response = await appClient.index.$get({}, { headers: { "test-credential-id": "unknown" } });

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toStrictEqual({ code: "no credential", legacy: "no credential" });
  });

  describe("on shutdown", () => {
    it("ends open streams and refuses new ones", async () => {
      const open = read(await appClient.index.$get({}, { headers: { "test-credential-id": "events" } }));
      await expect(open.next()).resolves.toBe("event: ready\ndata: \n\n");
      const pending = appClient.index.$get({}, { headers: { "test-credential-id": "events" } });

      close();

      await expect(open.next()).resolves.toBeUndefined();
      const late = await pending;
      expect(late.status).toBe(200);
      await expect(read(late).next()).resolves.toBeUndefined();
    });
  });
});

const readers = new Set<{ cancel: () => Promise<void> }>();

function read(response: Response) {
  if (!response.body) throw new Error("no body");
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  const handle = {
    next: () => reader.read().then(({ value }) => value),
    cancel: () => reader.cancel(),
  };
  readers.add(handle);
  return handle;
}
