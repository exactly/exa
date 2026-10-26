import "./mocks/sentry";

import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as Supervise from "../supervise";

const hooks = {
  activity: vi.fn<() => Hook>(),
  block: vi.fn<() => Hook>(),
  bridge: vi.fn<() => Hook>(),
  manteca: vi.fn<() => Hook>(),
  panda: vi.fn<() => Hook>(),
  persona: vi.fn<() => Hook>(),
};
const workers = { hook: vi.fn<() => Worker>(), maturity: vi.fn<() => Worker>() };
const closers = { hook: vi.fn<() => Promise<void>>(), maturity: vi.fn<() => Promise<void>>() };
const mocks = {
  api: vi.fn<() => Hook>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.resetModules();
  mocks.api.mockReset().mockReturnValue({ app: new Hono(), ready: Promise.resolve() });
  mocks.supervise.mockReset();
  for (const [name, create] of Object.entries(hooks)) {
    create.mockReset().mockReturnValue({
      app: new Hono().post("/", (c) => c.json({ hook: name })),
      ready: Promise.resolve(),
    });
    vi.doMock(`../hooks/${name}`, () => ({ default: create }));
  }
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
    for (const [name, create] of Object.entries({ ...hooks, ...workers })) {
      expect(create).toHaveBeenCalledTimes(enabled.includes(name) ? 1 : 0);
    }
    const responses = await Promise.all(
      Object.keys(hooks).map(async (name) => {
        const response = await app.request(`/hooks/${name}`, { method: "POST" });
        return [name, response.status, await response.text()];
      }),
    );
    expect(responses).toStrictEqual(
      Object.keys(hooks).map((name) =>
        enabled.includes(name) ? [name, 200, JSON.stringify({ hook: name })] : [name, 404, "404 Not Found"],
      ),
    );
    await handle.close();
    for (const [name, close] of Object.entries(closers)) {
      expect(close).toHaveBeenCalledTimes(enabled.includes(name) ? 1 : 0);
    }
  });

  it("rejects unknown modules before starting any", async () => {
    vi.stubEnv("DISABLED_MODULES", "activity,chat");

    await expect(import("../index")).rejects.toThrow("unknown module");
    for (const create of Object.values({ ...hooks, ...workers })) expect(create).not.toHaveBeenCalled();
    expect(mocks.supervise).not.toHaveBeenCalled();
  });
});

type Hook = { app: Hono; ready: Promise<unknown> };
type Worker = { close: () => Promise<void>; ready: Promise<unknown> };
type Handle = { app: Hono; close(): Promise<unknown>; ready: Promise<unknown[]> };
