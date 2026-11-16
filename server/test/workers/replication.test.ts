import "../mocks/sentry";

import { captureException, withMonitor } from "@sentry/node";
import { Queue, QueueEvents } from "bullmq";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import database from "../../database";
import { bullmq } from "../../utils/redis";
import { name } from "../../workers/replication/job";
import replicationWorker from "../../workers/replication/worker";
import { finished, tip } from "../redis";

import type { Job } from "../../workers/replication/job";

const queue = new Queue<Job>(name, { connection: bullmq });
const events = new QueueEvents(name, { connection: bullmq, lastEventId: await tip(bullmq, queue) });
const worker = replicationWorker({ bullmq, database });
const monitor = { schedule: { type: "interval", value: 1, unit: "minute" }, checkinMargin: 2, maxRuntime: 1 }; // cspell:ignore checkin
let scheduler: Awaited<ReturnType<typeof queue.getJobScheduler>>;

beforeAll(async () => {
  await events.waitUntilReady();
  const scheduled = new Promise<void>((resolve) => {
    events.once("completed", () => {
      resolve();
    });
  });
  await worker.ready;
  await scheduled;
  scheduler = await queue.getJobScheduler(name);
  await queue.removeJobScheduler(name);
});

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await Promise.all([worker.close(), events.close(), queue.close()]);
});

describe("replication worker", () => {
  it("checks every minute", () => {
    expect(scheduler).toMatchObject({ key: name, every: 60_000 });
  });

  it("stays silent without replication", async () => {
    await check();

    expect(withMonitor).toHaveBeenCalledExactlyOnceWith(name, expect.any(Function), monitor);
    expect(captureException).not.toHaveBeenCalled();
  });

  describe("with a subscription", () => {
    beforeAll(async () => {
      await database.execute(sql.raw(`create publication ${name}`));
      await database.execute(sql`select pg_create_logical_replication_slot(${name}, 'pgoutput')`); // cspell:ignore pgoutput
      await database.execute(
        sql.raw(
          `create subscription ${name} connection 'host=localhost port=8432 dbname=postgres user=postgres password=postgres' publication ${name} with (create_slot = false, slot_name = ${name})`, // cspell:ignore dbname
        ),
      );
      await vi.waitUntil(
        () =>
          database
            .execute(sql`select active from pg_replication_slots where slot_name = ${name}`)
            .then(({ rows: [slot] }) => slot?.active === true),
        { timeout: 30_000, interval: 100 },
      );
    });

    afterAll(async () => {
      await database.execute(sql.raw(`drop subscription if exists ${name}`));
      await database.execute(sql.raw(`drop publication if exists ${name}`));
    });

    it("stays silent while it streams", async () => {
      await check();

      expect(withMonitor).toHaveBeenCalledExactlyOnceWith(name, expect.any(Function), monitor);
      expect(captureException).not.toHaveBeenCalled();
    });

    it("reports a disabled subscription", async () => {
      await database.execute(sql.raw(`alter subscription ${name} disable`));

      await check();

      expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error("replication disabled"), {
        level: "error",
        fingerprint: ["replication", "disabled"],
        contexts: {
          replication: {
            apply_error_count: 0,
            sync_error_count: 0,
            confl_insert_exists: 0, // cspell:ignore confl
            confl_update_origin_differs: 0,
            confl_update_exists: 0,
            confl_update_missing: 0,
            confl_delete_origin_differs: 0,
            confl_delete_missing: 0,
            confl_multiple_unique_conflicts: 0,
          },
        },
      });
    });
  });

  it.each([
    { slot: { lag: 0, stalled: false, status: "lost" }, error: "replication slot lost", reason: "lost" },
    {
      slot: { lag: 0, stalled: false, status: "unreserved" },
      error: "replication slot unreserved",
      reason: "unreserved",
    },
    { slot: { lag: 0, stalled: false, status: "extended" }, error: "replication slot extended", reason: "extended" },
    { slot: { lag: 0, stalled: true, status: "reserved" }, error: "replication stalled", reason: "stalled" },
    { slot: { lag: 2 ** 27 + 1, stalled: false, status: "reserved" }, error: "replication lagging", reason: "lagging" },
  ])("reports $reason slots", async ({ slot, error, reason }) => {
    vi.spyOn(database, "execute").mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [slot],
    });

    await check();

    expect(captureException).toHaveBeenCalledExactlyOnceWith(new Error(error), {
      level: "error",
      fingerprint: ["replication", reason],
      contexts: { replication: slot },
    });
  });

  it("tolerates lag up to its limit", async () => {
    vi.spyOn(database, "execute").mockResolvedValueOnce({
      command: "SELECT",
      fields: [],
      oid: 0,
      rowCount: 1,
      rows: [{ lag: 2 ** 27, stalled: false, status: "reserved" }],
    });

    await check();

    expect(captureException).not.toHaveBeenCalled();
  });

  it("reports failed checks", async () => {
    const failure = new Error("connection terminated");
    vi.spyOn(database, "execute").mockRejectedValueOnce(failure);
    const id = randomUUID();

    await expect(check(id)).rejects.toThrow("connection terminated");

    expect(captureException).toHaveBeenCalledExactlyOnceWith(failure, {
      level: "error",
      tags: { queue: name, job: name },
      extra: { id },
    });
  });

  it("reports failed events without a job", () => {
    const error = new Error("failed event error");

    worker.queue.emit("failed", undefined, error, "active");

    expect(captureException).toHaveBeenCalledExactlyOnceWith(error, {
      level: "error",
      tags: { queue: name, job: undefined },
      extra: { id: undefined },
    });
  });
});

async function check(id = randomUUID()) {
  const done = finished(events, id);
  await queue.add(name, {}, { jobId: id });
  await done.catch(async (error: unknown) => {
    await vi.waitUntil(() => vi.mocked(captureException).mock.calls.length > 0);
    throw error;
  });
}
