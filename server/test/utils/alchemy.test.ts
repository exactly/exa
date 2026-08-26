import { parse } from "valibot";
import { padHex } from "viem";
import { anvil, base, baseSepolia } from "viem/chains";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import createAlchemy, { activityNetworks, network, NETWORKS } from "../../utils/alchemy";
import ServiceError from "../../utils/ServiceError";

const account = parse(Address, padHex("0xb0b", { size: 20 }));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("activity networks", () => {
  it("selects only anvil for the local stack", () => {
    expect([...activityNetworks(anvil.id).keys()]).toStrictEqual(["ANVIL"]);
  });

  it("selects every production network for production stacks", () => {
    expect([...activityNetworks(base.id).keys()]).toStrictEqual(
      [...NETWORKS].filter(([name, chain]) => name !== "ANVIL" && !chain.testnet).map(([name]) => name),
    );
  });

  it("selects every test network for test stacks", () => {
    expect([...activityNetworks(baseSepolia.id).keys()]).toStrictEqual(
      [...NETWORKS].filter(([name, chain]) => name !== "ANVIL" && !!chain.testnet).map(([name]) => name),
    );
  });

  it("fails for unsupported stacks", () => {
    expect(() => activityNetworks(0)).toThrow("unsupported activity stack");
  });

  it("fails when the local capability disappears", () => {
    vi.spyOn(NETWORKS, "get").mockReturnValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined -- missing capability

    expect(() => activityNetworks(anvil.id)).toThrow("missing anvil activity network");
  });
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
    expect(bodies()).toStrictEqual([{ webhook_id: "activity", addresses_to_add: [account], addresses_to_remove: [] }]);
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

  it("lists and finds the active webhook for the compiled network", async () => {
    const hooks = [
      webhook("inactive", network(), false),
      webhook("other", "ETH_MAINNET"),
      { ...webhook("graphql"), webhook_type: "GRAPHQL" as const },
      webhook("activity"),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(Response.json({ data: hooks })));
    const alchemy = createAlchemy("key");

    await expect(alchemy.getWebhooks()).resolves.toStrictEqual(hooks);
    await expect(alchemy.findWebhook(({ webhook_type }) => webhook_type === "ADDRESS_ACTIVITY")).resolves.toStrictEqual(
      webhook("activity"),
    );

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(1, "https://dashboard.alchemy.com/api/team-webhooks", {
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "key" },
    });
  });

  it("fails when alchemy cannot list webhooks", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => Promise.resolve(new Response("failed", { status: 500 })));

    await expect(createAlchemy("key").getWebhooks()).rejects.toBeInstanceOf(ServiceError);

    expect(fetch).toHaveBeenCalledTimes(11);
  });

  it("creates webhooks with explicit and compiled networks", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ data: webhook("explicit", "OPT_SEPOLIA") }))
      .mockResolvedValueOnce(Response.json({ data: webhook("default") }));
    const alchemy = createAlchemy("key");

    await alchemy.createWebhook({
      addresses: [],
      network: "OPT_SEPOLIA",
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: "https://example.com/activity",
    });
    await alchemy.createWebhook({
      addresses: [],
      webhook_type: "ADDRESS_ACTIVITY",
      webhook_url: "https://example.com/activity",
    });

    expect(bodies()).toStrictEqual([
      {
        addresses: [],
        network: "OPT_SEPOLIA",
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: "https://example.com/activity",
      },
      {
        addresses: [],
        network: network(),
        webhook_type: "ADDRESS_ACTIVITY",
        webhook_url: "https://example.com/activity",
      },
    ]);
  });

  it("lists paginated webhook addresses", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(Response.json({ data: [account], pagination: { cursors: { after: "next" }, total_count: 1 } })),
    );
    const alchemy = createAlchemy("key");

    await expect(alchemy.getWebhookAddresses("activity")).resolves.toStrictEqual({
      data: [account],
      pagination: { cursors: { after: "next" }, total_count: 1 },
    });
    await alchemy.getWebhookAddresses("activity", "cursor");

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://dashboard.alchemy.com/api/webhook-addresses?webhook_id=activity&limit=100",
      { headers: { "Content-Type": "application/json", "X-Alchemy-Token": "key" } },
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://dashboard.alchemy.com/api/webhook-addresses?webhook_id=activity&limit=100&after=cursor",
      { headers: { "Content-Type": "application/json", "X-Alchemy-Token": "key" } },
    );
  });

  it("activates webhooks", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));

    await createAlchemy("key").setWebhookActive("activity", true);

    expect(fetch).toHaveBeenCalledExactlyOnceWith("https://dashboard.alchemy.com/api/update-webhook", {
      body: JSON.stringify({ webhook_id: "activity", is_active: true }),
      headers: { "Content-Type": "application/json", "X-Alchemy-Token": "key" },
      method: "PUT",
    });
  });

  it.each([
    [
      "create",
      (alchemy: ReturnType<typeof createAlchemy>) =>
        alchemy.createWebhook({ addresses: [], webhook_type: "ADDRESS_ACTIVITY", webhook_url: "https://example.com" }),
    ],
    ["addresses", (alchemy: ReturnType<typeof createAlchemy>) => alchemy.getWebhookAddresses("activity")],
    ["activation", (alchemy: ReturnType<typeof createAlchemy>) => alchemy.setWebhookActive("activity", true)],
  ])("fails rejected %s requests", async (_, request) => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response("failed", { status: 500 }));

    await expect(request(createAlchemy("key"))).rejects.toBeInstanceOf(ServiceError);
  });
});

function bodies() {
  return vi.mocked(fetch).mock.calls.map(([, init]) => {
    if (!init || typeof init.body !== "string") throw new Error("missing body");
    return JSON.parse(init.body) as unknown;
  });
}

function webhook(id: string, current = network(), active = true) {
  return {
    id,
    is_active: active,
    network: current,
    signing_key: `${id}-key`,
    webhook_type: "ADDRESS_ACTIVITY" as const,
    webhook_url: "https://example.com/activity",
  };
}
