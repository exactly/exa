import { parse } from "valibot";
import { padHex } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createAlchemy, { network } from "../../utils/alchemy";
import ServiceError from "../../utils/ServiceError";

const account = parse(Address, padHex("0xb0b", { size: 20 }));
const webhook = {
  id: "activity",
  network: network(),
  webhook_type: "ADDRESS_ACTIVITY" as const,
  webhook_url: "https://example.com/hooks/activity",
  signing_key: "signing-key",
  is_active: true,
};

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

  it("rejects empty keys", () => expect(() => createAlchemy("")).toThrow());

  it("finds webhooks with the configured key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: [webhook] }));

    await expect(createAlchemy("find-key").findWebhook(() => true)).resolves.toStrictEqual(webhook);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/team-webhooks", {
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "find-key" },
    });
  });

  it("creates webhooks with the configured key", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({ data: webhook }));

    await expect(
      createAlchemy("create-key").createWebhook({
        addresses: [],
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: "https://example.com/hooks/activity",
      }),
    ).resolves.toStrictEqual(webhook);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/create-webhook", {
      body: JSON.stringify({
        addresses: [],
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: "https://example.com/hooks/activity",
        network: network(),
      }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "create-key" },
      method: "POST",
    });
  });

  it("adds addresses to the active webhook", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await createAlchemy("update-key").addWebhookAddresses("activity", [account]);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      body: JSON.stringify({ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "update-key" },
      method: "PATCH",
    });
    expect(bodies()).toStrictEqual([{ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }]);
  });

  it("ignores updates without an active webhook", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await createAlchemy("key").updateWebhookAddresses(undefined, [account]);

    expect(fetch).not.toHaveBeenCalled();
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
    expect(bodies()).toStrictEqual([{ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }]);
  });
});
