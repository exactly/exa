import { captureException, captureMessage, withScope } from "@sentry/node";
import { setTimeout as wait } from "node:timers/promises";
import { parse } from "valibot";

import { Address } from "@exactly/common/validation";

import { attempts, name, type Job } from "./job";
import { activityNetworks, activityUrl } from "../../utils/alchemy";
import createWorker from "../worker";

import type * as schema from "../../database/schema";
import type createAlchemy from "../../utils/alchemy";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Redis } from "ioredis";

export default function worker({
  alchemy,
  bullmq,
  database,
}: {
  alchemy: ReturnType<typeof createAlchemy>;
  bullmq: Redis;
  database: NodePgDatabase<typeof schema>;
}) {
  let next = 0;
  const webhooks = request(() => alchemy.getWebhooks()).then((existing) =>
    attempt(
      activityNetworks(),
      async ([network]) => {
        const matches = existing.filter(
          (hook) =>
            hook.webhook_type === "ADDRESS_ACTIVITY" && hook.webhook_url === activityUrl && hook.network === network,
        );
        if (matches.length > 1) throw new Error(`duplicate ${network} activity webhooks`);
        const current = matches[0];
        if (current) {
          if (!current.is_active) throw new Error(`inactive ${network} activity webhook`);
          return current;
        }
        return request(() =>
          alchemy.createWebhook({ addresses: [], network, webhook_type: "ADDRESS_ACTIVITY", webhook_url: activityUrl }),
        );
      },
      "activity webhook discovery failed",
    ),
  );
  return createWorker<Job>({
    attempts,
    bullmq,
    failed(job, error) {
      withScope((scope) => {
        if (job) scope.setUser({ id: job.data.account });
        captureException(error, {
          level: "error",
          tags: { queue: name, job: job?.name },
          extra: { account: job?.data.account, attempts: job?.attemptsMade, id: job?.id },
        });
      });
    },
    name,
    ready: webhooks.then(async (hooks) => {
      const persisted = await database.query.credentials.findMany({ columns: { account: true } });
      const accounts = persisted.map(({ account }) => parse(Address, account));
      await attempt(
        hooks,
        async (hook) => {
          for (let index = 0; index < accounts.length; index += 500)
            await request(() => alchemy.addWebhookAddresses(hook.id, accounts.slice(index, index + 500)));
          const {
            pagination: { total_count: total },
          } = await request(() => alchemy.getWebhookAddresses(hook.id));
          if (total >= 90_000)
            captureMessage("alchemy activity webhook nearing capacity", {
              level: "warning",
              tags: { network: hook.network, webhook: hook.id },
              extra: { addresses: total },
            });
          if (total >= 100_000) throw new Error(`${hook.network} activity webhook capacity reached`);
          if (!hook.is_active && total > 0) {
            await request(() => alchemy.setWebhookActive(hook.id, true));
            hook.is_active = true;
          }
        },
        "activity webhook reconciliation failed",
      );
    }),
    async process(job) {
      await attempt(
        await webhooks,
        async (hook) => {
          await alchemy.addWebhookAddresses(hook.id, [job.data.account]);
          if (!hook.is_active) {
            await alchemy.setWebhookActive(hook.id, true);
            hook.is_active = true;
          }
        },
        "account subscription failed",
      );
    },
  });

  async function request<T>(callback: () => Promise<T>) {
    await wait(Math.max(0, next - Date.now()));
    next = Date.now() + 200;
    return callback();
  }
}

async function attempt<T, Result>(values: Iterable<T>, callback: (value: T) => Promise<Result>, message: string) {
  const results: Result[] = [];
  const errors: unknown[] = [];
  for (const value of values) {
    try {
      results.push(await callback(value));
    } catch (error: unknown) {
      errors.push(error);
    }
  }
  if (errors.length > 0) throw new AggregateError(errors, message);
  return results;
}
