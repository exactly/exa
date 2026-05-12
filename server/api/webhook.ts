import { Mutex } from "async-mutex";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { randomBytes } from "node:crypto";
import { resolve4, resolve6 } from "node:dns/promises";
import {
  array,
  literal,
  metadata,
  nullish,
  object,
  optional,
  parse,
  partial,
  picklist,
  pipe,
  record,
  regex,
  string,
  union,
  url,
  type InferOutput,
} from "valibot";

import database, { sources } from "../database";
import orgValidator from "../middleware/org";
import auth from "../utils/auth";
import validatorHook from "../utils/validatorHook";

const slug = /^[a-z0-9-]{1,64}$/;

const BaseWebhook = object({
  url: pipe(string(), url()),
  transaction: optional(
    object({
      created: optional(pipe(string(), url())),
      updated: optional(pipe(string(), url())),
      completed: optional(pipe(string(), url())),
    }),
  ),
  card: optional(object({ updated: optional(pipe(string(), url())) })),
  user: optional(object({ updated: optional(pipe(string(), url())) })),
});

const WebhookPatch = partial(
  object({
    url: pipe(string(), url()),
    transaction: object({
      created: nullish(pipe(string(), url())),
      updated: nullish(pipe(string(), url())),
      completed: nullish(pipe(string(), url())),
    }),
    card: object({ updated: nullish(pipe(string(), url())) }),
    user: object({ updated: nullish(pipe(string(), url())) }),
  }),
);
const PatchResponse = object({
  ...BaseWebhook.entries,
  name: pipe(string("invalid name"), regex(slug, "invalid name")),
});

const WebhookConfig = object({
  type: picklist(["integrator", "uphold"]),
  webhooks: record(string(), object({ ...BaseWebhook.entries, secret: string() })),
});

const CreateResponse = object({
  ...BaseWebhook.entries,
  name: pipe(string("invalid name"), regex(slug, "invalid name")),
  secret: string(),
});

const mutexes = new Map<string, Mutex>();
function createMutex(organizationId: string) {
  const mutex = new Mutex();
  mutexes.set(organizationId, mutex);
  return mutex;
}

export default new Hono()
  .get(
    "/:name?",
    orgValidator(),
    describeRoute({
      summary: "Get webhooks",
      description: `Retrieve the organization's webhook information. Without a name, returns all webhooks as a map keyed by name, or an empty object when the organization has no webhooks configured. With a name, returns the matching webhook, or 404 when the organization has no webhooks configured or no webhook with that name exists. Signing secrets are never returned. Only owner and admin roles can read the webhook information.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Webhook information",
          content: {
            "application/json": {
              schema: resolver(union([record(string(), BaseWebhook), BaseWebhook]), { errorMode: "ignore" }),
            },
          },
        },
        400: {
          description: "Invalid webhook name",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("invalid name"), metadata({ examples: ["invalid name"] })),
                  message: optional(array(string())),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({ code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })) }),
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
        404: {
          description: "Webhook not found",
          content: {
            "application/json": {
              schema: resolver(object({ code: pipe(literal("not found"), metadata({ examples: ["not found"] })) }), {
                errorMode: "ignore",
              }),
            },
          },
        },
      },
    }),
    vValidator(
      "param",
      object({ name: optional(pipe(string("invalid name"), regex(slug, "invalid name"))) }),
      validatorHook({ code: "invalid name" }),
    ),
    async (c) => {
      const { name } = c.req.valid("param");
      const organizations = await auth.api.listOrganizations({ headers: c.req.raw.headers });
      const organizationId = organizations[0]?.id;
      if (!organizationId) return c.json({ code: "no organization" }, 403);

      const { success } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId, permissions: { webhook: ["read"] } },
      });
      if (!success) return c.json({ code: "no permission" }, 403);

      const source = await database.query.sources.findFirst({ where: eq(sources.id, organizationId) });

      if (name) {
        if (!source) return c.json({ code: "not found" as const }, 404);
        const config = parse(WebhookConfig, source.config);
        const webhook = config.webhooks[name];
        if (!webhook) return c.json({ code: "not found" as const }, 404);
        return c.json(parse(BaseWebhook, webhook) satisfies InferOutput<typeof BaseWebhook>, 200);
      }
      if (!source) return c.json({} satisfies Record<string, InferOutput<typeof BaseWebhook>>, 200);
      return c.json(
        parse(object({ ...WebhookConfig.entries, webhooks: record(string(), BaseWebhook) }), source.config)
          .webhooks satisfies Record<string, InferOutput<typeof BaseWebhook>>,
        200,
      );
    },
  )
  .post(
    "/:name?",
    orgValidator(),
    describeRoute({
      summary: "Creates a webhook",
      description: `Creates a new webhook with the given name and generates its signing secret. The name may be provided either as a path parameter (\`POST /webhook/:name\`) or as a \`name\` field in the request body for backwards compatibility; the path parameter takes precedence when both are present. Returns 400 when neither is provided, when the path name fails the slug pattern, when the body fails validation (e.g. missing or malformed \`url\`, body \`name\` not matching the slug pattern), or when any URL uses a non-\`https\` scheme, fails to resolve, or resolves to a private/loopback address. Returns 409 when a webhook with that name already exists for the organization. Only owner and admin roles can create a webhook.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        201: {
          description: "Webhook created",
          content: { "application/json": { schema: resolver(CreateResponse, { errorMode: "ignore" }) } },
        },
        400: {
          description: "Invalid webhook name, body, or URL",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(string(), metadata({ examples: ["invalid name", "bad request", "invalid url"] })),
                  message: optional(array(string())),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({ code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })) }),
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
        409: {
          description: "A webhook with the given name already exists",
          content: {
            "application/json": {
              schema: resolver(
                object({ code: pipe(literal("name conflict"), metadata({ examples: ["name conflict"] })) }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
      },
    }),
    vValidator(
      "param",
      object({ name: optional(pipe(string("invalid name"), regex(slug, "invalid name"))) }),
      validatorHook({ code: "invalid name" }),
    ),
    vValidator(
      "json",
      object({ name: optional(pipe(string("invalid name"), regex(slug, "invalid name"))), ...BaseWebhook.entries }),
      validatorHook(),
    ),
    async (c) => {
      const { name: bodyName, ...payload } = c.req.valid("json");
      const name = c.req.valid("param").name ?? bodyName;
      if (!name) return c.json({ code: "invalid name" as const }, 400);
      const organizations = await auth.api.listOrganizations({ headers: c.req.raw.headers });
      const id = organizations[0]?.id;
      if (!id) return c.json({ code: "no organization" }, 403);
      const { success: canCreate } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId: id, permissions: { webhook: ["create"] } },
      });
      if (!canCreate) return c.json({ code: "no permission" }, 403);

      try {
        await validateUrls(payload);
      } catch {
        return c.json({ code: "invalid url" as const }, 400);
      }

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex.runExclusive(async () => {
        const source = await database.query.sources.findFirst({ where: eq(sources.id, id) });
        if (source) {
          const config = parse(WebhookConfig, source.config);
          if (config.webhooks[name]) return c.json({ code: "name conflict" as const }, 409);
          const webhook = { ...payload, secret: randomBytes(32).toString("hex") };
          await database
            .update(sources)
            .set({ config: { ...config, webhooks: { ...config.webhooks, [name]: webhook } } })
            .where(eq(sources.id, id));
          return c.json({ name, ...webhook } satisfies InferOutput<typeof CreateResponse>, 201);
        }
        const webhook = { ...payload, secret: randomBytes(32).toString("hex") };
        await database.insert(sources).values({ id, config: { type: "integrator", webhooks: { [name]: webhook } } });
        return c.json({ name, ...webhook } satisfies InferOutput<typeof CreateResponse>, 201);
      });
    },
  )
  .patch(
    "/:name",
    orgValidator(),
    describeRoute({
      summary: "Updates a webhook",
      description: `Partially updates an existing webhook by name. Only fields included in the request body are modified; omitted fields (including the top-level \`url\` and any nested per-event URLs) keep their stored value. Passing \`null\` for a per-event URL clears it; the parent group is dropped when it has no per-event URLs left. Returns 400 when the path name fails the slug pattern, the body fails validation, or any URL uses a non-\`https\` scheme, fails to resolve, or resolves to a private/loopback address. Returns 404 when the organization has no source configured or no webhook with that name exists. The signing secret is preserved and is not returned in the response. Only owner and admin roles can update a webhook.`,
      tags: ["Webhook"],
      security: [{ siweAuth: [] }],
      validateResponse: true,
      responses: {
        200: {
          description: "Webhook updated",
          content: { "application/json": { schema: resolver(PatchResponse, { errorMode: "ignore" }) } },
        },
        400: {
          description: "Invalid webhook name, body, or URL",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(string(), metadata({ examples: ["invalid name", "bad request", "invalid url"] })),
                  message: optional(array(string())),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({ code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })) }),
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
        404: {
          description: "Webhook not found",
          content: {
            "application/json": {
              schema: resolver(object({ code: pipe(literal("not found"), metadata({ examples: ["not found"] })) }), {
                errorMode: "ignore",
              }),
            },
          },
        },
      },
    }),
    vValidator(
      "param",
      object({ name: pipe(string("invalid name"), regex(slug, "invalid name")) }),
      validatorHook({ code: "invalid name" }),
    ),
    vValidator("json", WebhookPatch, validatorHook()),
    async (c) => {
      const { name } = c.req.valid("param");
      const payload = c.req.valid("json");
      const organizations = await auth.api.listOrganizations({ headers: c.req.raw.headers });
      const id = organizations[0]?.id;
      if (!id) return c.json({ code: "no organization" }, 403);
      const { success: canUpdate } = await auth.api.hasPermission({
        headers: c.req.raw.headers,
        body: { organizationId: id, permissions: { webhook: ["update"] } },
      });
      if (!canUpdate) return c.json({ code: "no permission" }, 403);

      try {
        await validateUrls(payload);
      } catch {
        return c.json({ code: "invalid url" as const }, 400);
      }

      const mutex = mutexes.get(id) ?? createMutex(id);
      return mutex.runExclusive(async () => {
        const source = await database.query.sources.findFirst({
          where: eq(sources.id, id),
        });
        if (!source) return c.json({ code: "not found" as const }, 404);
        const config = parse(WebhookConfig, source.config);
        const existing = config.webhooks[name];
        if (!existing) return c.json({ code: "not found" as const }, 404);
        const transaction = patchEvents(existing.transaction, payload.transaction);
        const card = patchEvents(existing.card, payload.card);
        const user = patchEvents(existing.user, payload.user);
        const webhook = {
          url: payload.url ?? existing.url,
          secret: existing.secret,
          ...(transaction && { transaction }),
          ...(card && { card }),
          ...(user && { user }),
        };
        await database
          .update(sources)
          .set({ config: { ...config, webhooks: { ...config.webhooks, [name]: webhook } } })
          .where(eq(sources.id, id));
        return c.json(parse(PatchResponse, { name, ...webhook }) satisfies InferOutput<typeof PatchResponse>, 200);
      });
    },
  )
  .delete(
    "/:name",
    orgValidator(),
    describeRoute({
      summary: "Deletes a webhook",
      description: `Deletes a webhook by name. When the deleted webhook is the last one in the organization's source, the source row is removed entirely; otherwise the remaining webhooks are kept. Returns 404 when the organization has no source configured or no webhook with that name exists. Only owner and admin roles can delete a webhook.`,
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
        400: {
          description: "Invalid webhook name",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: pipe(literal("invalid name"), metadata({ examples: ["invalid name"] })),
                  message: optional(array(string())),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        401: {
          description: "Unauthorized",
          content: {
            "application/json": {
              schema: resolver(
                object({ code: pipe(literal("unauthorized"), metadata({ examples: ["unauthorized"] })) }),
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
        404: {
          description: "Webhook not found",
          content: {
            "application/json": {
              schema: resolver(object({ code: pipe(literal("not found"), metadata({ examples: ["not found"] })) }), {
                errorMode: "ignore",
              }),
            },
          },
        },
      },
    }),
    vValidator(
      "param",
      object({ name: pipe(string("invalid name"), regex(slug, "invalid name")) }),
      validatorHook({ code: "invalid name" }),
    ),
    async (c) => {
      const { name } = c.req.valid("param");
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
        if (!source) return c.json({ code: "not found" as const }, 404);
        const config = parse(WebhookConfig, source.config);
        if (!config.webhooks[name]) return c.json({ code: "not found" as const }, 404);
        const { [name]: _, ...remainingWebhooks } = config.webhooks;
        await (Object.keys(remainingWebhooks).length === 0
          ? database.delete(sources).where(eq(sources.id, id))
          : database
              .update(sources)
              .set({ config: { ...config, webhooks: remainingWebhooks } })
              .where(eq(sources.id, id)));
        return c.json({ code: "ok" as const }, 200);
      });
    },
  );

function patchEvents(
  existing: Record<string, string> | undefined,
  patch: Record<string, null | string | undefined> | undefined,
) {
  if (!patch) return existing;
  const merged = new Map<string, string>(Object.entries(existing ?? {}));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      merged.delete(key);
    } else if (value !== undefined) {
      merged.set(key, value);
    }
  }
  return merged.size === 0 ? undefined : Object.fromEntries(merged);
}

async function validateUrls(payload: InferOutput<typeof WebhookPatch>) {
  await Promise.all(
    [
      payload.url,
      payload.transaction?.created,
      payload.transaction?.updated,
      payload.transaction?.completed,
      payload.card?.updated,
      payload.user?.updated,
    ]
      .filter((u): u is string => typeof u === "string")
      .map(async (raw) => {
        const { hostname, protocol } = new URL(raw);
        if (protocol !== "https:") throw new Error("url must use https");
        const [v4, v6] = await Promise.all([resolve4(hostname).catch(() => []), resolve6(hostname).catch(() => [])]);
        const addresses = [...v4, ...v6];
        if (addresses.length === 0) throw new Error("url does not resolve");
        if (
          addresses
            .map((ip) => (ip.startsWith("::ffff:") ? ip.slice(7).toLowerCase() : ip.toLowerCase()))
            .some((ip) => {
              if (ip.includes(":")) return /^(?:::1$|fe[89a-f]|f[cd]|2001:db8:)/.test(ip);
              const parts = ip.split(".").map(Number);
              return (
                parts[0] === 127 ||
                parts[0] === 10 ||
                (parts[0] === 172 && parts[1] !== undefined && parts[1] >= 16 && parts[1] <= 31) ||
                (parts[0] === 192 && parts[1] === 168) ||
                (parts[0] === 169 && parts[1] === 254) ||
                ip === "0.0.0.0"
              );
            })
        ) {
          throw new Error("url resolves to private address");
        }
      }),
  );
}
