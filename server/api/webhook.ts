import { Mutex } from "async-mutex";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { randomBytes } from "node:crypto";
import { literal, metadata, object, optional, parse, picklist, pipe, record, string, union } from "valibot";

import database, { sources } from "../database";
import authValidator from "../middleware/auth";
import auth from "../utils/auth";
import validatorHook from "../utils/validatorHook";

const BaseWebhook = object({
  url: string(),
  transaction: optional(
    object({ created: optional(string()), updated: optional(string()), completed: optional(string()) }),
  ),
  card: optional(object({ updated: optional(string()) })),
  user: optional(object({ updated: optional(string()) })),
});

const Webhook = object({ ...BaseWebhook.entries, secret: string() });

const WebhookConfig = object({ type: picklist(["uphold"]), webhooks: record(string(), Webhook) });

const mutexes = new Map<string, Mutex>();
function createMutex(organizationId: string) {
  const mutex = new Mutex();
  mutexes.set(organizationId, mutex);
  return mutex;
}

export default new Hono()
  .get(
    "/",
    authValidator(),
    describeRoute({
      summary: "Get webhook information",
      description: `Retrieve the organization's webhook information for an authenticated user the belongs to the organization. Only owner and admin roles can read the webhook information.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Webhook information",
          content: { "application/json": { schema: resolver(record(string(), BaseWebhook), { errorMode: "ignore" }) } },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                  legacy: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        403: {
          description: "User doesn't belong to the organization",
          content: {
            "application/json": {
              schema: resolver(
                union([
                  object({ code: pipe(literal("no organization"), metadata({ examples: ["no organization"] })) }),
                  object({ code: pipe(literal("no permission"), metadata({ examples: ["no permission"] })) }),
                ]),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const organizations = await auth.api.listOrganizations({
        headers: c.req.raw.headers,
      });
      const organizationId = organizations[0]?.id;
      if (!organizationId) return c.json({ code: "no organization" }, 403);

      const { success: canRead } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId, permissions: { webhook: ["read"] } },
      });
      if (!canRead) return c.json({ code: "no permission" }, 403);

      const source = await database.query.sources.findFirst({
        where: eq(sources.id, organizationId),
      });
      const config = parse(
        object({ ...WebhookConfig.entries, webhooks: record(string(), BaseWebhook) }),
        source?.config,
      );
      return c.json(config.webhooks, 200);
    },
  )
  .post(
    "/",
    authValidator(),
    describeRoute({
      summary: "Creates or updates a webhook",
      description: `it creates a new webhook if it doesn't exist or updates the existing webhook if it does. Only owner and admin roles can create or update a webhook.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Webhook created or updated",
          content: { "application/json": { schema: resolver(Webhook, { errorMode: "ignore" }) } },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                  legacy: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        403: {
          description: "User doesn't belong to the organization",
          content: {
            "application/json": {
              schema: resolver(
                union([
                  object({ code: pipe(literal("no organization"), metadata({ examples: ["no organization"] })) }),
                  object({ code: pipe(literal("no permission"), metadata({ examples: ["no permission"] })) }),
                ]),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
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
      const organizations = await auth.api.listOrganizations({ headers: c.req.raw.headers });
      const id = organizations[0]?.id;
      if (!id) return c.json({ code: "no organization" }, 403);
      const { success: canCreate } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId: id, permissions: { webhook: ["create"] } },
      });
      if (!canCreate) return c.json({ code: "no permission" }, 403);

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex.runExclusive(async () => {
        const source = await database.query.sources.findFirst({
          where: eq(sources.id, id),
        });
        if (source) {
          const config = parse(WebhookConfig, source.config);
          const webhook = { ...payload, secret: config.webhooks[name]?.secret ?? randomBytes(16).toString("hex") };
          await database
            .update(sources)
            .set({ config: { ...config, webhooks: { ...config.webhooks, [name]: webhook } } })
            .where(eq(sources.id, id));
          return c.json(webhook, 200);
        } else {
          const webhook = { ...payload, secret: randomBytes(16).toString("hex") };
          await database.insert(sources).values({ id, config: { type: "uphold", webhooks: { [name]: webhook } } });
          return c.json(webhook, 200);
        }
      });
    },
  )
  .delete(
    "/",
    authValidator(),
    vValidator("json", object({ name: string() }), validatorHook()),
    describeRoute({
      summary: "Deletes a webhook",
      description: `it deletes the webhook with the given name. Only owner and admin roles can delete a webhook.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Webhook deleted",
          content: {
            "application/json": { schema: resolver(object({ code: literal("ok") }), { errorMode: "ignore" }) },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                  legacy: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        403: {
          description: "User doesn't belong to the organization",
          content: {
            "application/json": {
              schema: resolver(
                union([
                  object({ code: pipe(literal("no organization"), metadata({ examples: ["no organization"] })) }),
                  object({ code: pipe(literal("no permission"), metadata({ examples: ["no permission"] })) }),
                ]),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
    async (c) => {
      const { name } = c.req.valid("json");
      const organizations = await auth.api.listOrganizations({ headers: c.req.raw.headers });
      const id = organizations[0]?.id;
      if (!id) return c.json({ code: "no organization" }, 403);

      const { success: canDelete } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId: id, permissions: { webhook: ["delete"] } },
      });
      if (!canDelete) return c.json({ code: "no permission" }, 403);

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex.runExclusive(async () => {
        const source = await database.query.sources.findFirst({
          where: eq(sources.id, id),
        });
        if (source) {
          const config = parse(WebhookConfig, source.config);
          const { [name]: _, ...remainingWebhooks } = config.webhooks;
          await database
            .update(sources)
            .set({ config: { ...config, webhooks: remainingWebhooks } })
            .where(eq(sources.id, id));
        }
        return c.json({ code: "ok" }, 200);
      });
    },
  );
