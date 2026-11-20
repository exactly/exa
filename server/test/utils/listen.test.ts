import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { setImmediate } from "node:timers/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import database from "../../database";
import listen from "../../utils/listen";

import type { PoolClient } from "pg";

const pool = database.$client;

describe("listen", () => {
  it("syncs on start and on every notification", async () => {
    const sync = vi.fn(() => Promise.resolve());
    const listener = listen(pool, sync);

    await listener.ready;
    expect(sync).toHaveBeenCalledOnce();
    await pool.query(`NOTIFY "indexer_live_query"`);
    await vi.waitFor(() => expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2));
    await listener.close();
  });

  it("passes the payload of a custom channel", async () => {
    const sync = vi.fn((_payload?: string) => Promise.resolve());
    const listener = listen(pool, sync, undefined, "custom");

    await listener.ready;
    await pool.query("select pg_notify('custom', 'hello')");
    await vi.waitFor(() => expect(sync).toHaveBeenCalledWith("hello"));
    expect(sync.mock.calls[0]?.[0]).toBeUndefined();
    await listener.close();
  });

  it("captures notification sync failures", async () => {
    const error = new Error("sync");
    const sync = vi
      .fn<() => Promise<unknown>>()
      .mockImplementationOnce(() => Promise.resolve())
      .mockRejectedValue(error);
    const listener = listen(pool, sync, { queue: "test" });

    await listener.ready;
    await pool.query(`NOTIFY "indexer_live_query"`);
    await vi.waitFor(() =>
      expect(captureException).toHaveBeenCalledWith(error, { level: "error", tags: { queue: "test" } }),
    );
    await listener.close();
  });

  it("releases the client when listening fails", async () => {
    const error = new Error("listen");
    const client = await pool.connect();
    vi.spyOn(client as { query: (text: string) => Promise<unknown> }, "query").mockImplementationOnce(() =>
      Promise.reject(error),
    );
    const release = vi.spyOn(client, "release");
    connectWith(client);
    const sync = vi.fn<() => Promise<unknown>>();
    const listener = listen(pool, sync);

    await expect(listener.ready).rejects.toBe(error);
    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    expect(sync).not.toHaveBeenCalled();
    await expect(listener.close()).resolves.toBeUndefined();
  });

  it("releases once when the connection fails while listening", async () => {
    const error = new Error("lost");
    const client = await pool.connect();
    vi.spyOn(client as { query: (text: string) => Promise<unknown> }, "query").mockImplementationOnce(() => {
      client.emit("error", error);
      return Promise.reject(error);
    });
    const release = vi.spyOn(client, "release");
    connectWith(client);
    const listener = listen(pool, vi.fn<() => Promise<unknown>>());

    await expect(listener.ready).rejects.toBe(error);
    expect(release).toHaveBeenCalledExactlyOnceWith(error);
    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, { level: "error" });
  });

  it("reconnects and catches up after a connection error", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const sync = vi.fn(() => Promise.resolve());
    const listener = listen(pool, sync);
    await listener.ready;
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);
    const release = vi.spyOn(client, "release");
    const error = new Error("lost");

    client.emit("error", error);

    expect(release).toHaveBeenCalledExactlyOnceWith(error);
    expect(captureException).toHaveBeenCalledWith(error, { level: "error" });
    await vi.waitFor(() => expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(connect).toHaveBeenCalledTimes(2);
    await listener.close();
  });

  it("retries a failed reconnect", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const sync = vi.fn(() => Promise.resolve());
    const listener = listen(pool, sync);
    await listener.ready;
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);
    const error = new Error("unreachable");
    connect.mockImplementationOnce(() => Promise.reject(error));

    client.emit("error", new Error("lost"));

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(error, { level: "error" }));
    await vi.waitFor(() => expect(sync.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 3000 });
    expect(connect).toHaveBeenCalledTimes(3);
    await listener.close();
  });

  it("stops reconnecting once closed", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const listener = listen(
      pool,
      vi.fn(() => Promise.resolve()),
    );
    await listener.ready;
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);
    const error = new Error("unreachable");
    connect.mockImplementationOnce(() => Promise.reject(error));

    client.emit("error", new Error("lost"));
    await listener.close();

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(error, { level: "error" }));
    expect(connect).toHaveBeenCalledTimes(2);
  });

  it("stops syncing once closed", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const listener = listen(
      pool,
      vi.fn(() => Promise.resolve()),
    );
    await listener.ready;
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);

    await listener.close();

    expect(client.listenerCount("notification")).toBe(0);
  });

  it("waits for a pending reconnect when closing", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const sync = vi.fn(() => Promise.resolve());
    const listener = listen(pool, sync);
    await listener.ready;
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);
    const next = await pool.connect();
    const release = vi.spyOn(next, "release");
    const listening = Promise.withResolvers<unknown>();
    const query = vi
      .spyOn(next as { query: (text: string) => Promise<unknown> }, "query")
      .mockImplementationOnce(() => listening.promise);
    const { promise, resolve } = Promise.withResolvers<PoolClient>();
    connect.mockImplementationOnce(() => promise);
    sync.mockClear();

    client.emit("error", new Error("lost"));
    const closing = listener.close();
    resolve(next);
    await setImmediate();
    expect(query).toHaveBeenCalledExactlyOnceWith(`LISTEN "indexer_live_query"`);
    next.emit("notification", { channel: "indexer_live_query", processId: 0 });
    listening.resolve({});
    await closing;

    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    expect(sync).not.toHaveBeenCalled();
  });

  it("waits for a pending reconnect when closing after a failed first sync", async () => {
    const connect = vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect");
    const sync = vi.fn<() => Promise<unknown>>(() => Promise.resolve()).mockRejectedValueOnce(new Error("sync"));
    const listener = listen(pool, sync);
    await expect(listener.ready).rejects.toThrow("sync");
    const client = await (connect.mock.results[0]?.value as Promise<PoolClient>);
    const next = await pool.connect();
    const release = vi.spyOn(next, "release");
    const { promise, resolve } = Promise.withResolvers<PoolClient>();
    connect.mockImplementationOnce(() => promise);
    sync.mockClear();

    client.emit("error", new Error("lost"));
    let done = false;
    const closing = listener.close().then(() => {
      done = true;
    });
    await setImmediate();
    expect(done).toBe(false);
    resolve(next);
    await closing;

    expect(release).toHaveBeenCalledExactlyOnceWith(true);
    expect(sync).not.toHaveBeenCalled();
  });

  it("releases a connection that completes after closing", async () => {
    const sync = vi.fn<() => Promise<unknown>>();
    const listener = listen(pool, sync);

    await listener.close();

    await expect(listener.ready).resolves.toBeUndefined();
    expect(sync).not.toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

function connectWith(client: PoolClient) {
  vi.spyOn(pool as { connect: () => Promise<PoolClient> }, "connect").mockImplementationOnce(() =>
    Promise.resolve(client),
  );
}
