import { parse } from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import { addWebhookAddresses } from "../../utils/alchemy";
import ServiceError from "../../utils/ServiceError";

const account = parse(Address, "0xb12057309bdDd6e071d5AAF9714C5f15E02441D6");

function bodies() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    if (!init || typeof init.body !== "string") throw new Error("missing body");
    return JSON.parse(init.body) as unknown;
  });
}

describe("alchemy", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds addresses to the active webhook", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await addWebhookAddresses("activity", [account]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }]);
  });

  it("fails when no active webhook exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await expect(addWebhookAddresses(undefined, [account])).rejects.toThrow("no active webhook");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores empty address updates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await addWebhookAddresses("activity", []);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails when alchemy rejects the update", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("activity failed", { status: 500 }));

    await expect(addWebhookAddresses("activity", [account])).rejects.toBeInstanceOf(ServiceError);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(bodies()).toStrictEqual([{ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }]);
  });
});
