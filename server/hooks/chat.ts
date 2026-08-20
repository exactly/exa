import { vValidator } from "@hono/valibot-validator";
import { captureException } from "@sentry/node";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { createHmac, timingSafeEqual } from "node:crypto";
import * as v from "valibot";

import { own } from "../supervise";
import validatorHook from "../utils/validatorHook";
import createQueue from "../workers/chat/queue";

import type { Redis } from "ioredis";

export default function chat({
  redis,
  whatsappFrom,
  whatsappSecret,
  whatsappVerifyToken,
}: {
  redis: Redis;
  whatsappFrom: string;
  whatsappSecret: string;
  whatsappVerifyToken?: string;
}) {
  redis.on("error", (error: unknown) => captureException(error));
  const queue = createQueue(redis);
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
        if (!verify(await c.req.text(), whatsappSecret, signature)) return c.json({ code: "invalid signature" }, 401);
      }),
      vValidator("json", event, validatorHook({ code: "bad chat" })),
      async (c) => {
        const delivered = parse(c.req.valid("json"));
        const foreign = [...new Set(delivered.map(({ phoneNumberId }) => phoneNumberId))].filter(
          (phoneNumberId) => phoneNumberId !== whatsappFrom,
        );
        if (foreign.length > 0) {
          captureException(new Error("chat delivered to another business number"), {
            level: "error",
            extra: { expected: whatsappFrom, foreign },
          });
        }
        const threads = new Map<string, [(typeof delivered)[number], ...(typeof delivered)[number][]]>();
        for (const message of new Map(
          delivered
            .filter(({ phoneNumberId }) => phoneNumberId === whatsappFrom)
            .map((incoming) => [incoming.id, incoming] as const),
        ).values()) {
          const key = `${message.phoneNumberId}/${message.from}`;
          const thread = threads.get(key);
          if (thread) thread.push(message);
          else threads.set(key, [message]);
        }
        await Promise.all(
          [...threads.values()].map(([sender, ...tail]) =>
            queue
              .enqueue({
                id: sender.id,
                contact: sender.contact,
                from: sender.from,
                text: [sender, ...tail].map(({ text }) => text).join("\n"),
              })
              .catch((error: unknown) => {
                captureException(error, { extra: { sender }, tags: { job: "chat", queue: "chat" } });
                throw error;
              }),
          ),
        );
        return c.json({ code: "ok" });
      },
    );
  return own({ app, ready: Promise.resolve() }, () => queue.close());
}

function verify(body: string, secret: string, signature?: string) {
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
