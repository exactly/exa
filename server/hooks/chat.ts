import { vValidator } from "@hono/valibot-validator";
import { Mastra } from "@mastra/core";
import { RequestContext } from "@mastra/core/request-context";
import { Observability } from "@mastra/observability";
import { RedisStore } from "@mastra/redis";
import { SentryExporter } from "@mastra/sentry";
import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";

import { credentials } from "../database/schema";
import { config } from "../instrument.cjs";
import assistant from "../utils/assistant";
import createWhatsapp from "../utils/chat";
import validatorHook from "../utils/validatorHook";

import type { context } from "../utils/assistant";
import type { InferPublicSchema } from "@mastra/core/schema";

export default function chat({
  anthropicKey,
  chatKey,
  postgresUrl,
  redisUrl,
  whatsappFrom,
  whatsappSecret,
  whatsappToken,
  whatsappVerifyToken,
}: {
  anthropicKey: string;
  chatKey: string;
  postgresUrl: string;
  redisUrl: string;
  whatsappFrom: string;
  whatsappSecret?: string;
  whatsappToken: string;
  whatsappVerifyToken?: string;
}) {
  const whatsapp = createWhatsapp({ from: whatsappFrom, key: chatKey, token: whatsappToken });
  const database = drizzle(postgresUrl, { schema: { credentials } });
  const store = new RedisStore({ id: "chat", connectionString: redisUrl });
  store.getClient().on("error", (error: unknown) => captureException(error));
  const { agent, reply } = assistant(anthropicKey, whatsapp, store);
  const mastra = new Mastra({
    agents: { assistant: agent },
    observability: new Observability({
      configs: {
        default: {
          serviceName: "chat",
          requestContextKeys: ["account", "bridgeId", "credentialId", "pandaId", "whatsappId"],
          exporters: [
            new SentryExporter({
              dsn: config.dsn,
              environment: config.environment,
              release: config.release,
              tracesSampleRate: config.tracesSampleRate,
              options: config,
            }),
          ],
        },
      },
    }),
  });
  const app = new Hono()
    .get(
      "/",
      vValidator(
        "query",
        v.object({
          "hub.mode": v.literal("subscribe"),
          "hub.verify_token": v.string(),
          "hub.challenge": v.string(),
        }),
        validatorHook({ code: "bad verification" }),
      ),
      (c) =>
        c.req.valid("query")["hub.verify_token"] === whatsappVerifyToken
          ? c.text(c.req.valid("query")["hub.challenge"])
          : c.json({ code: "invalid verify token" }, 403),
    )
    .post(
      "/",
      validator("header", async ({ "x-hub-signature-256": signature }, c) => {
        if (!verify(await c.req.text(), signature, whatsappSecret)) return c.json({ code: "invalid signature" }, 401);
      }),
      vValidator("json", event, validatorHook({ code: "bad chat" })),
      async (c) => {
        // TODO implement queue
        const messages = new Map(parse(c.req.valid("json")).map((message) => [message.id, message] as const));
        await Promise.allSettled(
          [...Map.groupBy(messages.values(), ({ from, phoneNumberId }) => `${phoneNumberId}/${from}`).values()].map(
            // TODO move to worker
            async (thread) => {
              const sender = thread[0];
              if (!sender) return;
              return database.query.credentials
                .findFirst({
                  columns: { id: true, pandaId: true, bridgeId: true, account: true },
                  where: eq(credentials.whatsappId, sender.from),
                })
                .then((credential) =>
                  reply(thread.map(({ text }) => text).join("\n"), {
                    memory: { resource: sender.from, thread: `${sender.phoneNumberId}/${sender.from}` },
                    requestContext: new RequestContext<InferPublicSchema<typeof context>>([
                      ["account", credential?.account],
                      ["bridgeId", credential?.bridgeId ?? undefined],
                      ["credentialId", credential?.id],
                      ["pandaId", credential?.pandaId ?? undefined],
                      ["whatsappId", sender.from],
                    ]),
                  }),
                )
                .then(({ text }) => whatsapp.send(sender.from, text))
                .catch((error: unknown) => {
                  captureException(error, { extra: { sender } });
                  throw error;
                });
            },
          ),
        ).then((threads) => {
          if (threads.some((thread) => thread.status === "rejected")) throw new Error("chat delivery failed");
        });
        return c.json({ code: "ok" });
      },
    );
  return {
    app,
    close() {
      return Promise.all([mastra.shutdown(), database.$client.end(), store.close()]);
    },
    ready: Promise.resolve(),
  };
}

function verify(body: string, signature?: string, secret?: string) {
  if (!secret) return true;
  if (!signature) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const received = Buffer.from(signature);
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function parse({ entry }: v.InferOutput<typeof event>) {
  return entry.flatMap(({ changes }) =>
    changes.flatMap(({ value: { contacts, messages, metadata } }) =>
      (messages ?? []).flatMap((message) =>
        message.text
          ? [
              {
                id: message.id,
                from: message.from_user_id,
                text: message.text.body,
                contact: contacts?.find(({ user_id }) => user_id === message.from_user_id)?.profile?.name,
                phoneNumberId: metadata.phone_number_id,
              },
            ]
          : [],
      ),
    ),
  );
}

const event = v.object({
  entry: v.array(
    v.object({
      changes: v.array(
        v.object({
          value: v.object({
            metadata: v.object({ phone_number_id: v.string() }),
            contacts: v.optional(
              v.array(
                v.object({
                  user_id: v.string(),
                  profile: v.optional(v.object({ name: v.optional(v.string()) })),
                }),
              ),
            ),
            messages: v.optional(
              v.array(
                v.object({
                  id: v.string(),
                  from_user_id: v.string(),
                  type: v.string(),
                  text: v.optional(v.object({ body: v.string() })),
                }),
              ),
            ),
          }),
        }),
      ),
    }),
  ),
});
