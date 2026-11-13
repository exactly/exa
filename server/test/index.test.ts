import "./mocks/sentry";

import { Hono } from "hono";
import { anvil, optimism, optimismSepolia } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../supervise";
import type * as Chain from "@exactly/common/generated/chain";
import type { Context } from "hono";

const hooks = {
  activity: vi.fn<() => Hook>(),
  block: vi.fn<() => Hook>(),
  bridge: vi.fn<() => Hook>(),
  manteca: vi.fn<() => Hook>(),
  panda: vi.fn<() => Hook>(),
  persona: vi.fn<() => Hook>(),
};
const workers = { hook: vi.fn<() => Worker>(), maturity: vi.fn<() => Worker>() };
const closers = {
  block: vi.fn<() => Promise<void>>(),
  hook: vi.fn<() => Promise<void>>(),
  maturity: vi.fn<() => Promise<void>>(),
};
const mocks = {
  api: vi.fn<() => Hook>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("@hono/node-server/serve-static");
});

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset().mockReturnValue({ app: new Hono(), ready: Promise.resolve() });
  mocks.supervise.mockReset();
  for (const [name, create] of Object.entries(hooks)) {
    create.mockReset().mockReturnValue({
      app: new Hono().post("/", (c) => c.json({ hook: name })),
      ready: Promise.resolve(),
      ...(name === "block" && { close: closers.block }),
    });
    vi.doMock(`../hooks/${name}`, () => ({ default: create }));
  }
  closers.block.mockReset().mockResolvedValue();
  for (const name of ["hook", "maturity"] as const) {
    closers[name].mockReset().mockResolvedValue();
    workers[name].mockReset().mockReturnValue({ close: closers[name], ready: Promise.resolve() });
  }
  vi.doMock("../api", () => ({ default: mocks.api }));
  vi.doMock("../supervise", async (importOriginal) => ({
    ...(await importOriginal<typeof Supervise>()),
    default: mocks.supervise,
  }));
  vi.doMock("../utils/maturity", () => ({ default: workers.maturity }));
  vi.doMock("../workers/hook/worker", () => ({ default: workers.hook }));
});

describe("server", () => {
  it.each([
    {
      disabled: undefined,
      enabled: ["activity", "block", "bridge", "manteca", "panda", "persona", "hook", "maturity"],
    },
    { disabled: "", enabled: ["activity", "block", "bridge", "manteca", "panda", "persona", "hook", "maturity"] },
    { disabled: "activity,maturity,hook", enabled: ["block", "bridge", "manteca", "panda", "persona"] },
  ])("starts only enabled modules when disabling $disabled", async ({ disabled, enabled }) => {
    if (disabled !== undefined) vi.stubEnv("DISABLED_MODULES", disabled);

    const { default: app } = await import("../index");
    const created = mocks.supervise.mock.calls[0]?.[1];
    if (!created) throw new Error("missing server");
    const handle = await created;

    await expect(handle.ready).resolves.toHaveLength(1 + enabled.length);
    expect(mocks.api).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ business: true }));
    for (const [name, create] of Object.entries({ ...hooks, ...workers })) {
      expect(create).toHaveBeenCalledTimes(enabled.includes(name) ? 1 : 0);
    }
    const responses = await Promise.all(
      Object.keys(hooks).map(async (name) => {
        const response = await app.request(`/hooks/${name}`, { method: "POST" });
        return [name, response.status, await response.text()];
      }),
    );
    const page = await app.request("/+not-found.html");
    const body = await page.text();
    expect(responses).toStrictEqual(
      Object.keys(hooks).map((name) =>
        enabled.includes(name) ? [name, 200, JSON.stringify({ hook: name })] : [name, 404, body],
      ),
    );
    await handle.close();
    for (const [name, close] of Object.entries(closers)) {
      expect(close).toHaveBeenCalledTimes(enabled.includes(name) ? 1 : 0);
    }
  });

  it.each([
    { id: anvil.id, testnet: true, source: "indexer" },
    { id: optimismSepolia.id, testnet: true, source: "indexer" },
    { id: optimism.id, testnet: false, source: "alchemy" },
  ])("reads hooks from $source on chain $id", async ({ id, testnet, source }) => {
    vi.doMock("@exactly/common/generated/chain", async (importOriginal) => {
      const original = await importOriginal<typeof Chain>();
      return { ...original, default: { ...original.default, id, testnet } };
    });

    await import("../index");

    expect(hooks.block).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ source }));
    vi.doUnmock("@exactly/common/generated/chain");
  });

  it("disables business", async () => {
    vi.stubEnv("DISABLED_MODULES", "business");

    await import("../index");

    expect(mocks.api).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ business: false }));
    for (const create of Object.values({ ...hooks, ...workers })) expect(create).toHaveBeenCalledOnce();
  });

  it("rejects unknown modules before starting any", async () => {
    vi.stubEnv("DISABLED_MODULES", "activity,chat");

    await expect(import("../index")).rejects.toThrow("unknown module");
    for (const create of Object.values({ ...hooks, ...workers })) expect(create).not.toHaveBeenCalled();
    expect(mocks.supervise).not.toHaveBeenCalled();
  });

  it("caches hashed assets and revalidates the rest", async () => {
    const modified = new Date(0).toUTCString();
    const page = (c: Context) => c.body("app", 200, { "Last-Modified": modified });
    vi.doMock("@hono/node-server/serve-static", () => ({ serveStatic: () => page }));

    const { default: app } = await import("../index");
    const responses = await Promise.all([
      app.request("/_expo/static/js/web/entry-0.js"),
      app.request("/assets/icon.0.png"),
      app.request("/"),
      app.request("/", { headers: { "If-Modified-Since": modified } }),
      app.request("/", { headers: { "If-Modified-Since": new Date(1000).toUTCString() } }),
      app.request("/", { headers: { "If-Modified-Since": modified, "If-None-Match": '"other"' } }),
    ]);

    expect(responses.map(({ status, headers }) => [status, headers.get("cache-control")])).toStrictEqual([
      [200, "public, max-age=31536000, immutable"],
      [200, "public, max-age=31536000, immutable"],
      [200, "no-cache"],
      [304, "no-cache"],
      [200, "no-cache"],
      [200, "no-cache"],
    ]);
  });
});

type Hook = { app: Hono; close?: () => Promise<void>; ready: Promise<unknown> };
type Worker = { close: () => Promise<void>; ready: Promise<unknown> };
type Handle = { app: Hono; close(): Promise<unknown>; ready: Promise<unknown[]> };
