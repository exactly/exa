import { and, eq, ne } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { validator as vValidator } from "hono-openapi/valibot";
import { randomInt } from "node:crypto";
import { description, object, parse, pipe, string, title } from "valibot";

import database, { credentials } from "../database";
import auth from "../middleware/auth";
import { decode, sendCode } from "../utils/chat";
import redis from "../utils/redis";
import validatorHook from "../utils/validatorHook";

const Token = object({
  token: pipe(string(), title("Chat token"), description("Encrypted token encoding the chat id to associate.")),
});

export default new Hono()
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
    auth(),
    vValidator("query", Token, validatorHook({ code: "bad token" })),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const waId = await decode(c.req.valid("query").token).catch(() => undefined);
      if (!waId) return c.json({ code: "bad token" }, 400);
      const taken = await database.query.credentials.findFirst({
        columns: { id: true },
        where: and(eq(credentials.waId, waId), ne(credentials.id, credentialId)),
      });
      if (taken) return c.json({ code: "wa taken" }, 400);
      const current = await database.query.credentials.findFirst({
        columns: { waId: true },
        where: eq(credentials.id, credentialId),
      });
      if (current?.waId && current.waId !== waId) return c.json({ code: "wa associated" }, 400);
      return c.json({ code: "available" }, 200);
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Confirm the chat association",
      description: "Verifies the validation code and associates the chat id with the credential, overriding conflicts.",
      tags: ["Chat"],
      responses: { 200: { description: "Chat id associated with the credential." } },
    }),
    auth(),
    vValidator(
      "json",
      object({ code: pipe(string(), title("Validation code"), description("Code sent to the user.")) }),
      validatorHook({ code: "bad code" }),
    ),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const pending = await redis.getdel(`chat:${credentialId}`);
      if (!pending) return c.json({ code: "no verification" }, 400);
      const { waId, code } = parse(object({ code: string(), waId: string() }), JSON.parse(pending));
      if (code !== c.req.valid("json").code) return c.json({ code: "bad code" }, 400);
      await database.transaction(async (tx) => {
        await tx
          .update(credentials)
          .set({ waId: null })
          .where(and(eq(credentials.waId, waId), ne(credentials.id, credentialId)));
        await tx.update(credentials).set({ waId }).where(eq(credentials.id, credentialId));
      });
      return c.json({ waId }, 200);
    },
  )
  .post(
    "/code",
    describeRoute({
      summary: "Send a validation code",
      description: "Sends a validation code to the id encoded in the token.",
      tags: ["Chat"],
      responses: {
        200: { description: "Validation code sent." },
        429: { description: "A code was already sent to this chat id recently." },
      },
    }),
    auth(),
    vValidator("json", Token, validatorHook({ code: "bad token" })),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      let waId: string;
      try {
        waId = await decode(c.req.valid("json").token);
      } catch {
        return c.json({ code: "bad token" }, 400);
      }
      if (!(await redis.set(`chat:cooldown:${waId}`, "1", "PX", 60_000, "NX"))) {
        // cspell:ignore cooldown
        return c.json({ code: "too soon" }, 429);
      }
      const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
      await redis.set(`chat:${credentialId}`, JSON.stringify({ waId, code }), "PX", 10 * 60_000);
      await sendCode(waId, code);
      return c.json({ code: "sent" }, 200);
    },
  );
