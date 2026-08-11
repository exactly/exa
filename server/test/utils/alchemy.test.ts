import { parse } from "valibot";
import { padHex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createAlchemy from "../../utils/alchemy";
import ServiceError from "../../utils/ServiceError";

const account = parse(Address, padHex("0xb0b", { size: 20 }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("alchemy", () => {
  it("adds addresses to the active webhook", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await createAlchemy("update-key").addWebhookAddresses("activity", [account]);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      body: JSON.stringify({ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "update-key" },
      method: "PATCH",
    });
  });

  it("fails when no active webhook exists", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await expect(createAlchemy("key").addWebhookAddresses(undefined, [account])).rejects.toThrow("no active webhook");

    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores empty address updates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await createAlchemy("key").addWebhookAddresses("activity", []);

    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails when alchemy rejects the update", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("activity failed", { status: 500 }));

    await expect(createAlchemy("key").addWebhookAddresses("activity", [account])).rejects.toBeInstanceOf(ServiceError);

    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
