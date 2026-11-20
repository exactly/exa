import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { parse } from "valibot";
import { padHex } from "viem";
import { afterAll, beforeAll, describe, expect, it, onTestFinished, vi } from "vitest";

import { Address } from "@exactly/common/validation";

import database from "../../database";
import { emit, listen, publisher, subscribe, type Kind } from "../../utils/events";

const account = parse(Address, padHex("0xe7e473", { size: 20 }));
const pool = database.$client;

describe("events", () => {
  let events: ReturnType<typeof listen>;

  beforeAll(async () => {
    publisher(database);
    events = listen(pool);
    await events.ready;
  });

  afterAll(() => events.close());

  it("delivers events through postgres", async () => {
    const listener = vi.fn<(kind: Kind) => void>();
    onTestFinished(subscribe(account, listener, () => undefined) ?? (() => undefined));

    emit(account, "card");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("card"));
  });

  it("ignores malformed notifications", async () => {
    const listener = vi.fn<(kind: Kind) => void>();
    onTestFinished(subscribe(account, listener, () => undefined) ?? (() => undefined));

    await pool.query("select pg_notify('events', $1)", [`unknown:${account}`]);
    await pool.query("select pg_notify('events', 'card:0xbad')");
    emit(account, "kyc");

    await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("kyc"));
    expect(listener).toHaveBeenCalledOnce();
  });

  it("ends open streams when the connection drops", async () => {
    const end = vi.fn();
    const unsubscribe = subscribe(account, vi.fn(), end);
    onTestFinished(unsubscribe ?? (() => undefined));
    const listener = vi.fn<(kind: Kind) => void>();
    onTestFinished(subscribe(account, listener, () => undefined) ?? (() => undefined));

    await pool.query(`select pg_terminate_backend(pid) from pg_stat_activity where query = 'LISTEN "events"'`);

    await vi.waitFor(() => expect(end).toHaveBeenCalledOnce());
    await vi.waitFor(async () => {
      emit(account, "ramp");
      await vi.waitFor(() => expect(listener).toHaveBeenCalledWith("ramp"), { timeout: 200 });
    });
  });

  it("reports publish failures", async () => {
    const error = new Error("down");
    vi.spyOn(pool as { query: (text: string, values: unknown[]) => Promise<unknown> }, "query").mockRejectedValueOnce(
      error,
    );

    emit(account, "activity");

    await vi.waitFor(() => expect(captureException).toHaveBeenCalledWith(error, { level: "error" }));
  });
});
