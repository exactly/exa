import { captureException } from "@sentry/core";
import { and, eq, ne, or } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as vValidator } from "hono-openapi/valibot";
import { randomInt } from "node:crypto";
import { description, object, parse, pipe, string, title, union } from "valibot";

import { credentials } from "../database/schema";
import validatorHook from "../utils/validatorHook";

import type db from "../database";
import type { Auth } from "../middleware/auth";
import type createChat from "../utils/chat";
import type { Redis } from "ioredis";

const token = object({
  token: pipe(string(), title("Chat token"), description("Encrypted token encoding the chat id to associate.")),
});

export default function route({
  auth,
  chat,
  database,
  redis,
}: {
  auth: Auth;
  chat: ReturnType<typeof createChat>;
  database: typeof db;
  redis: Redis;
}) {
  return new Hono()
    .get(
      "/",
      describeRoute({
        summary: "Preflight a chat association",
        description: "Reports whether the chat id encoded in the token can be associated, surfacing conflicts as 400.",
        tags: ["Chat"],
        responses: {
          200: { description: "The id is available to associate." },
          400: { description: "Bad token, associated with another credential, or this credential already has one." },
        },
      }),
      auth,
      vValidator("query", token, validatorHook({ code: "bad token" })),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const whatsappId = await chat.decode(c.req.valid("query").token).catch((error: unknown) => {
          captureException(error, { level: "warning" });
          return null;
        });
        if (!whatsappId) return c.json({ code: "bad token" }, 400);
        const result = await database.query.credentials.findMany({
          columns: { id: true, whatsappId: true },
          where: or(eq(credentials.id, credentialId), eq(credentials.whatsappId, whatsappId)),
        });
        if (result.some(({ id }) => id !== credentialId)) return c.json({ code: "whatsapp taken" }, 400);
        const current = result.find(({ id }) => id === credentialId);
        if (current?.whatsappId && current.whatsappId !== whatsappId)
          return c.json({ code: "whatsapp associated" }, 400);
        return c.json({ code: "available" }, 200);
      },
    )
    .post(
      "/",
      describeRoute({
        summary: "Send a validation code or confirm the association",
        description:
          "With a token, sends a validation code to the encoded id. With a code, verifies it and associates the id with the credential, overriding conflicts.",
        tags: ["Chat"],
        responses: {
          200: { description: "Validation code sent, or chat id associated with the credential." },
          400: { description: "Bad token, no pending verification, or the submitted code is wrong." },
          429: { description: "A code was already sent to this id recently." },
        },
      }),
      auth,
      vValidator(
        "json",
        union([
          token,
          object({ code: pipe(string(), title("Validation code"), description("Code sent to the user.")) }),
        ]),
        validatorHook({ code: "bad request" }),
      ),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const payload = c.req.valid("json");
        if ("token" in payload) {
          const whatsappId = await chat.decode(payload.token).catch(() => null);
          if (!whatsappId) return c.json({ code: "bad token" }, 400);
          if (!(await redis.set(`chat:cooldown:${whatsappId}`, "1", "PX", 60_000, "NX"))) {
            // cspell:ignore cooldown
            return c.json({ code: "too soon" }, 429);
          }
          const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
          await redis.set(`chat:${credentialId}`, JSON.stringify({ whatsappId, code }), "PX", 10 * 60_000);
          await chat.send(whatsappId, `${code} is your Exa validation code. It expires in 10 minutes.`);
          return c.json({ code: "sent" }, 200);
        }
        const pending = await redis.getdel(`chat:${credentialId}`);
        if (!pending) return c.json({ code: "no verification" }, 400);
        const { whatsappId, code } = parse(object({ code: string(), whatsappId: string() }), JSON.parse(pending));
        if (code !== payload.code) return c.json({ code: "bad code" }, 400);
        await database.transaction(async (tx) => {
          await tx
            .update(credentials)
            .set({ whatsappId: null })
            .where(and(eq(credentials.whatsappId, whatsappId), ne(credentials.id, credentialId)));
          await tx.update(credentials).set({ whatsappId }).where(eq(credentials.id, credentialId));
        });
        return c.json({ whatsappId }, 200);
      },
    );
}
