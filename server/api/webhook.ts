import { vValidator } from "@hono/valibot-validator";
import { Mutex } from "async-mutex";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import crypto from "node:crypto";
import { object, optional, parse, picklist, record, string } from "valibot";

import database, { sources } from "../database";
import authValidator from "../middleware/auth";
import auth from "../utils/auth";
import validatorHook from "../utils/validatorHook";

const mutexes = new Map<string, Mutex>();
function createMutex(organizationId: string) {
  const mutex = new Mutex();
  mutexes.set(organizationId, mutex);
  return mutex;
}

export default new Hono()
  .post(
    "/",
    authValidator(),
    vValidator(
      "json",
      object({
        name: string(),
        url: string(),
        transaction: optional(
          object({
            created: optional(string()),
            updated: optional(string()),
            completed: optional(string()),
          }),
        ),
        card: optional(object({ updated: optional(string()) })),
        user: optional(object({ updated: optional(string()) })),
      }),
      validatorHook(),
    ),
    async (c) => {
      const { name, ...payload } = c.req.valid("json");
      const organizations = await auth.api.listOrganizations({
        headers: c.req.raw.headers,
      });
      const id = organizations[0]?.slug;
      if (!id) return c.json({ code: "no organization", legacy: "no organization" }, 401);

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex
        .runExclusive(async () => {
          const source = await database.query.sources.findFirst({
            where: eq(sources.id, id),
          });
          if (source) {
            const config = parse(WebhookConfig, source.config);
            const webhook = { ...payload, secret: config.webhooks[name]?.secret ?? crypto.randomUUID() };
            await database
              .update(sources)
              .set({
                config: {
                  ...config,
                  webhooks: {
                    ...config.webhooks,
                    [name]: webhook,
                  },
                },
              })
              .where(eq(sources.id, id));
            return c.json(webhook, 200);
          } else {
            const webhook = { ...payload, secret: crypto.randomUUID() };
            await database.insert(sources).values({
              id,
              config: {
                type: "uphold",
                webhooks: {
                  [name]: webhook,
                },
              },
            });
            return c.json(webhook, 200);
          }
        })
        .finally(() => {
          mutex.release();
        });
    },
  )
  .delete(
    "/",
    authValidator(),
    vValidator(
      "json",
      object({
        name: string(),
      }),
      validatorHook(),
    ),
    async (c) => {
      const { name } = c.req.valid("json");
      const organizations = await auth.api.listOrganizations({
        headers: c.req.raw.headers,
      });
      const id = organizations[0]?.slug;
      if (!id) return c.json({ code: "no organization", legacy: "no organization" }, 401);

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex
        .runExclusive(async () => {
          const source = await database.query.sources.findFirst({
            where: eq(sources.id, id),
          });
          if (source) {
            const config = parse(WebhookConfig, source.config);
            const { [name]: _, ...remainingWebhooks } = config.webhooks;
            await database
              .update(sources)
              .set({
                config: {
                  ...config,
                  webhooks: remainingWebhooks,
                },
              })
              .where(eq(sources.id, id));
          }
          return c.json({ code: "ok" }, 200);
        })
        .finally(() => {
          mutex.release();
        });
    },
  );

const WebhookConfig = object({
  type: picklist(["uphold"]),
  webhooks: record(
    string(),
    object({
      url: string(),
      secret: string(),
      transaction: optional(
        object({
          created: optional(string()),
          updated: optional(string()),
          completed: optional(string()),
        }),
      ),
      card: optional(object({ updated: optional(string()) })),
      user: optional(object({ updated: optional(string()) })),
    }),
  ),
});
