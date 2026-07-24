import "./mocks/sentry";

import { serve } from "@hono/node-server";
import { captureException, close as closeSentry } from "@sentry/node";
import { Hono } from "hono";
import { exit } from "node:process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import supervise, { own } from "../supervise";

import type * as Process from "node:process";

vi.mock("@hono/node-server", () => ({ serve: vi.fn() }));
vi.mock("node:process", async (importOriginal) => ({
  ...(await importOriginal<typeof Process>()),
  exit: vi.fn(),
}));

const mocks = {
  close: vi.fn<() => Promise<void>>(),
  exit: vi.mocked(exit),
  serverClose: vi.fn<(listener: (error?: Error) => void) => void>(),
  serverOnce: vi.fn<(event: string, listener: (error: Error) => void) => void>(),
  stderr: vi.fn<typeof console.error>(),
};
const listeners = new Map<string, () => void>();
const serverListeners = new Map<string, (error: Error) => void>();

afterEach(() => {
  process.exitCode = undefined;
  vi.restoreAllMocks();
});

beforeEach(() => {
  listeners.clear();
  serverListeners.clear();
  process.exitCode = undefined;
  mocks.close.mockReset().mockResolvedValue();
  mocks.exit.mockReset();
  mocks.serverClose.mockReset().mockImplementation((listener) => listener());
  mocks.serverOnce.mockReset().mockImplementation((event, listener) => {
    serverListeners.set(event, listener);
  });
  mocks.stderr.mockReset();
  vi.mocked(serve)
    .mockReset()
    .mockReturnValue({ close: mocks.serverClose, listening: true, once: mocks.serverOnce } as never);
  vi.mocked(captureException).mockReset();
  vi.mocked(closeSentry).mockReset().mockResolvedValue(true);
  vi.spyOn(console, "error").mockImplementation(mocks.stderr);
  vi.spyOn(process, "once").mockImplementation((event, listener) => {
    listeners.set(String(event), () => listener());
    return process;
  });
});

describe("own", () => {
  it("closes the result before its caller resources once", async () => {
    const closed = Promise.withResolvers<boolean>();
    const internal = vi.fn(() => closed.promise);
    const first = vi.fn<() => Promise<void>>().mockResolvedValue();
    const second = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handle = own({ close: internal, value: 69 }, first, second);

    const closing = handle.close();
    expect(handle.close()).toBe(closing);
    await vi.waitFor(() => expect(internal).toHaveBeenCalledOnce());
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    closed.resolve(true);
    await closing;

    expect(handle.value).toBe(69);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
  });

  it("adds a lifecycle to results without one", async () => {
    const close = vi.fn<() => Promise<void>>().mockResolvedValue();
    const handle = own({ value: 420 }, close);

    await handle.close();

    expect(handle.value).toBe(420);
    expect(close).toHaveBeenCalledOnce();
  });

  it("waits for every caller resource before rejecting", async () => {
    const error = new Error("close failed");
    const pending = Promise.withResolvers<boolean>();
    const first = vi.fn<() => Promise<void>>().mockRejectedValue(error);
    const second = vi.fn(() => pending.promise);
    const closing = own({}, first, second).close();

    await vi.waitFor(() => expect(second).toHaveBeenCalledOnce());
    await expect(Promise.race([closing.then(settled, settled), settle().then(() => "pending")])).resolves.toBe(
      "pending",
    );
    pending.resolve(true);

    await expect(closing).rejects.toBe(error);
  });
});

describe("supervise", () => {
  it("starts the app after it is ready and stops once", async () => {
    const ready = Promise.withResolvers<boolean>();
    const handle = createHandle(ready.promise);

    const app = superviseApp(handle);

    await settle();
    expect(serve).not.toHaveBeenCalled();
    ready.resolve(true);
    await vi.waitFor(() => expect(serve).toHaveBeenCalledOnce());
    expect([...listeners.keys()]).toStrictEqual(["SIGINT", "SIGTERM"]);
    expect(mocks.close).not.toHaveBeenCalled();
    expect(serve).toHaveBeenCalledExactlyOnceWith(app);

    signal("SIGTERM");
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0));
    signal("SIGINT");

    expect(mocks.serverClose).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(mocks.exit).toHaveBeenCalledOnce();
    expect(captureException).not.toHaveBeenCalled();
  });

  it.each([
    ["status", new Error("500"), ["{{ default }}", "500"]],
    ["leading whitespace", new Error("   400"), ["{{ default }}", "400"]],
    ["empty body", new Error("500 "), ["{{ default }}", "500"]],
    ["text body", new Error("503 unavailable"), ["{{ default }}", "503", "unavailable"]],
    ["nested error", new Error("502 upstream Error: failed"), ["{{ default }}", "502", "upstream Error: failed"]],
    ["json code", new Error('409 {"code":"conflict"}'), ["{{ default }}", "409", "conflict"]],
    ["json message", new Error('422 {"message":"invalid"}'), ["{{ default }}", "422", "invalid"]],
    ["json error", new Error('401 {"message":1,"error":"unauthorized"}'), ["{{ default }}", "401", "unauthorized"]],
    ["json fallback", new Error('400 {"message":1,"error":2}'), ["{{ default }}", "400", '{"message":1,"error":2}']],
    ["invalid separator", new Error("500x"), undefined],
    ["invalid status", new Error("bad"), undefined],
    ["invalid format", new Error("failure"), undefined],
  ])("captures and responds for %s errors", async (_, error, fingerprint) => {
    const app = new Hono().get("/", () => Promise.reject(error));
    const close = supervise("test", Promise.resolve({ ...createHandle(), app }));
    await settle();

    const response = await app.request("/");

    expect(response.status).toBe(555);
    expect(response.headers.get("content-type")).toBe("application/json");
    await expect(response.json()).resolves.toStrictEqual({
      code: "unexpected error",
      legacy: "unexpected error",
    });
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { unhandled: true },
      fingerprint,
    });
    await close();
  });

  it("captures asynchronous listen failures before closing", async () => {
    const error = new Error("address in use");
    vi.mocked(serve).mockReturnValueOnce({
      close: mocks.serverClose,
      listening: false,
      once: mocks.serverOnce,
    } as never);

    superviseApp();
    await vi.waitFor(() => expect(serve).toHaveBeenCalledOnce());
    serverError(error);

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(mocks.stderr).toHaveBeenCalledExactlyOnceWith(error);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { startup: true, entrypoint: "activity" },
    });
    expect(process.exitCode).toBe(1);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.serverClose).not.toHaveBeenCalled();
  });

  it("does not start when stopped before readiness", async () => {
    const ready = Promise.withResolvers<boolean>();

    superviseApp(createHandle(ready.promise));
    signal("SIGTERM");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0));
    ready.resolve(true);
    await ready.promise;
    await settle();

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
    expect(mocks.serverClose).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("ignores readiness failures while stopping", async () => {
    const ready = Promise.withResolvers<boolean>();
    const error = new Error("ready failed");

    superviseApp(createHandle(ready.promise));
    signal("SIGTERM");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0));
    ready.reject(error);
    await ready.promise.catch(() => undefined);
    await settle();

    expect(mocks.close).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("exits after cleaning up construction failures", async () => {
    const closed = Promise.withResolvers<boolean>();
    const error = new Error("construction failed");
    vi.mocked(closeSentry).mockReturnValueOnce(closed.promise);

    supervise("activity", Promise.reject(error));

    await vi.waitFor(() => expect(closeSentry).toHaveBeenCalledOnce());
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { startup: true, entrypoint: "activity" },
    });
    expect(process.exitCode).toBe(1);
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
    expect(mocks.serverClose).not.toHaveBeenCalled();
    expect(mocks.close).not.toHaveBeenCalled();
    expect(mocks.exit).not.toHaveBeenCalled();
    closed.resolve(true);
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
  });

  it("captures close failures after startup failures", async () => {
    const closeError = new Error("close failed");
    const startupError = new Error("startup failed");
    mocks.close.mockRejectedValueOnce(closeError);

    superviseApp(createHandle(Promise.reject(startupError)));

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenNthCalledWith(1, startupError, {
      level: "fatal",
      tags: { startup: true, entrypoint: "activity" },
    });
    expect(captureException).toHaveBeenNthCalledWith(2, closeError, {
      level: "fatal",
      tags: { close: true, entrypoint: "activity" },
    });
    expect(captureException).toHaveBeenCalledTimes(2);
    expect(mocks.stderr).toHaveBeenNthCalledWith(1, startupError);
    expect(mocks.stderr).toHaveBeenNthCalledWith(2, closeError);
    expect(process.exitCode).toBe(1);
  });

  it.each(["ready", "serve"] as const)("captures %s startup failures before closing", async (source) => {
    const error = new Error(`${source} failed`);
    if (source === "serve")
      vi.mocked(serve).mockImplementationOnce(() => {
        throw error;
      });

    superviseApp(createHandle(source === "ready" ? Promise.reject(error) : Promise.resolve()));

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { startup: true, entrypoint: "activity" },
    });
    expect(process.exitCode).toBe(1);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(mocks.serverClose).not.toHaveBeenCalled();
  });

  it.each(["handle", "server"] as const)("captures %s close failures before exiting", async (source) => {
    const error = new Error(`${source} close failed`);
    if (source === "handle") mocks.close.mockRejectedValueOnce(error);
    else mocks.serverClose.mockImplementationOnce((listener) => listener(error));

    superviseApp();
    await vi.waitFor(() => expect(serve).toHaveBeenCalledOnce());
    signal("SIGTERM");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { close: true, entrypoint: "activity" },
    });
    expect(mocks.serverClose).toHaveBeenCalledOnce();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
  });

  it("starts without an app or server", async () => {
    const close = supervise("test", Promise.resolve({ close: mocks.close, ready: Promise.resolve() }));
    await settle();

    expect(serve).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();

    await expect(close()).resolves.toBeUndefined();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(mocks.exit).not.toHaveBeenCalled();
  });

  it("closes checks after readiness", async () => {
    const closed = Promise.withResolvers<boolean>();
    const ready = Promise.withResolvers<boolean>();
    const sentry = Promise.withResolvers<boolean>();
    mocks.close.mockImplementationOnce(async () => {
      await closed.promise;
    });
    vi.mocked(closeSentry).mockReturnValueOnce(sentry.promise);
    supervise("test", Promise.resolve({ check: true, close: mocks.close, ready: ready.promise }));
    await settle();

    expect(mocks.close).not.toHaveBeenCalled();
    ready.resolve(true);
    await vi.waitFor(() => expect(mocks.close).toHaveBeenCalledOnce());
    expect(closeSentry).not.toHaveBeenCalled();
    expect(mocks.exit).not.toHaveBeenCalled();
    closed.resolve(true);
    await vi.waitFor(() => expect(closeSentry).toHaveBeenCalledOnce());
    expect(mocks.exit).not.toHaveBeenCalled();
    sentry.resolve(true);
    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(0));

    expect(serve).not.toHaveBeenCalled();
    expect(captureException).not.toHaveBeenCalled();
  });

  it("fails checks when closing fails", async () => {
    const error = new Error("check close failed");
    mocks.close.mockRejectedValueOnce(error);

    supervise("test", Promise.resolve({ check: true, close: mocks.close, ready: Promise.resolve() }));

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { close: true, entrypoint: "test" },
    });
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
  });

  it("captures startup failures without an app", async () => {
    const error = new Error("startup failed");

    supervise("test", Promise.resolve({ close: mocks.close, ready: Promise.reject(error) }));

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { startup: true, entrypoint: "test" },
    });
    expect(process.exitCode).toBe(1);
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
  });

  it("captures close failures without an app", async () => {
    const error = new Error("close failed");
    mocks.close.mockRejectedValueOnce(error);
    supervise("test", Promise.resolve({ close: mocks.close, ready: Promise.resolve() }));

    signal("SIGTERM");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(1));
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "fatal",
      tags: { close: true, entrypoint: "test" },
    });
    expect(closeSentry).toHaveBeenCalledOnce();
    expect(serve).not.toHaveBeenCalled();
  });

  it("preserves an existing exit code", async () => {
    superviseApp();
    await vi.waitFor(() => expect(serve).toHaveBeenCalledOnce());
    process.exitCode = 7;

    signal("SIGINT");

    await vi.waitFor(() => expect(mocks.exit).toHaveBeenCalledExactlyOnceWith(7));
  });
});

function createHandle(ready: Promise<unknown> = Promise.resolve()): Handle {
  return {
    close: mocks.close,
    ready,
  };
}

function superviseApp(handle = createHandle()) {
  const app = new Hono();
  supervise("activity", Promise.resolve({ ...handle, app }));
  return app;
}

function settle() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

function settled() {
  return "settled";
}

function signal(name: "SIGINT" | "SIGTERM") {
  const listener = listeners.get(name);
  if (!listener) throw new Error(`missing ${name} listener`);
  listener();
}

function serverError(error: Error) {
  const listener = serverListeners.get("error");
  if (!listener) throw new Error("missing server error listener");
  listener(error);
}

type Handle = {
  check?: boolean;
  close(): Promise<void>;
  ready: Promise<unknown>;
};
