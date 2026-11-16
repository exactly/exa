import { captureException, withMonitor } from "@sentry/node";
import { Queue } from "bullmq";
import { sql } from "drizzle-orm";
import { boolean, number, object, parse, picklist, record, string } from "valibot";

import { attempts, name, type Job } from "./job";
import { own } from "../../supervise";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function worker({ bullmq, database }: { bullmq: Redis; database: NodePgDatabase<typeof schema> }) {
  const queue = new Queue<Job>(name, {
    connection: bullmq,
    defaultJobOptions: { removeOnComplete: true, removeOnFail: true },
  });
  return own(
    createWorker<Job, unknown>({
      attempts,
      bullmq,
      failed(job, error) {
        captureException(error, { level: "error", tags: { queue: name, job: job?.name }, extra: { id: job?.id } });
      },
      name,
      ready: queue.upsertJobScheduler(name, { every: 60_000 }, { name }),
      process: () =>
        withMonitor(
          name,
          async () => {
            const [slot] = await database
              .execute(
                sql`
                  select
                    coalesce(not active and inactive_since < now() - interval '2 minutes', false) as stalled,
                    pg_wal_lsn_diff(pg_current_wal_lsn(), confirmed_flush_lsn)::float8 as lag,
                    wal_status as status
                  from pg_replication_slots
                  where slot_name = ${name}
                `,
              )
              .then(({ rows }) =>
                rows.map((row) =>
                  parse(
                    object({
                      lag: number(),
                      stalled: boolean(),
                      status: picklist(["reserved", "extended", "unreserved", "lost"]),
                    }),
                    row,
                  ),
                ),
              );
            if (slot) {
              if (slot.status !== "reserved") {
                captureException(new Error(`replication slot ${slot.status}`), {
                  level: "error",
                  fingerprint: ["replication", slot.status],
                  contexts: { replication: slot },
                });
              } else if (slot.stalled) {
                captureException(new Error("replication stalled"), {
                  level: "error",
                  fingerprint: ["replication", "stalled"],
                  contexts: { replication: slot },
                });
              } else if (slot.lag > 2 ** 27) {
                captureException(new Error("replication lagging"), {
                  level: "error",
                  fingerprint: ["replication", "lagging"],
                  contexts: { replication: slot },
                });
              }
            }
            // cspell:ignore subenabled subid subdbid datname
            const [subscription] = await database
              .execute(
                sql`
                  select s.subenabled as enabled, to_jsonb(t) - 'subid' - 'subname' - 'stats_reset' as stats
                  from pg_subscription s
                  join pg_stat_subscription_stats t on t.subid = s.oid
                  where s.subname = ${name} and s.subdbid = (select oid from pg_database where datname = current_database())
                `,
              )
              .then(({ rows }) =>
                rows.map((row) => parse(object({ enabled: boolean(), stats: record(string(), number()) }), row)),
              );
            if (subscription && !subscription.enabled) {
              captureException(new Error("replication disabled"), {
                level: "error",
                fingerprint: ["replication", "disabled"],
                contexts: { replication: subscription.stats },
              });
            }
          },
          { schedule: { type: "interval", value: 1, unit: "minute" }, checkinMargin: 2, maxRuntime: 1 }, // cspell:ignore checkin
        ),
    }),
    () => queue.close(),
  );
}
