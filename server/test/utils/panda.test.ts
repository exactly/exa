import "../mocks/sentry";

import { describe, expect, it, vi } from "vitest";

import * as panda from "../../utils/panda";
import ServiceError from "../../utils/ServiceError";

describe("panda request", () => {
  it("extracts entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getUser("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "user" });
  });

  it("extracts card entity from url on not found", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: false,
      status: 404,
      text: () => Promise.resolve('{"message":"Not Found","error":"NotFoundError","statusCode":404}'),
    } as Response);

    const rejection = panda.getCard("some-id");
    await expect(rejection).rejects.toBeInstanceOf(ServiceError);
    await expect(rejection).rejects.toMatchObject({ name: "PandaNotFound", status: 404, message: "card" });
  });
});

describe("mutex", () => {
  it("creates and retrieves mutex with string key", () => {
    const mutex = panda.createMutex("event-id");
    expect(panda.getMutex("event-id")).toBe(mutex);
  });

  it("creates and retrieves mutex with address key", () => {
    const address = "0x1234567890123456789012345678901234567890";
    const mutex = panda.createMutex(address as `0x${string}`);
    expect(panda.getMutex(address as `0x${string}`)).toBe(mutex);
  });

  it("returns undefined for unknown key", () => {
    expect(panda.getMutex("nonexistent")).toBeUndefined();
  });

  it("string and address keys are independent", () => {
    const stringMutex = panda.createMutex("some-key");
    const addressMutex = panda.createMutex("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`);
    expect(stringMutex).not.toBe(addressMutex);
  });
});
