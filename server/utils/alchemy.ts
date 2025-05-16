import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext } from "@sentry/node";
import type { Debugger } from "debug";
import { validator } from "hono/validator";
import { createHmac } from "node:crypto";
import type { BaseIssue, BaseSchema } from "valibot";

if (!process.env.ALCHEMY_WEBHOOKS_KEY) throw new Error("missing alchemy webhooks key");
export const webhooksKey = process.env.ALCHEMY_WEBHOOKS_KEY;

export function headerValidator(signingKeys: Set<string> | (() => Set<string>)) {
  return validator("header", async ({ "x-alchemy-signature": signature }, c) => {
    for (const signingKey of typeof signingKeys === "function" ? signingKeys() : signingKeys) {
      if (
        signature ===
        createHmac("sha256", signingKey)
          .update(Buffer.from(await c.req.arrayBuffer()))
          .digest("hex")
      ) {
        return;
      }
    }
    return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
  });
}

export function jsonValidator<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  debug: Debugger,
  filter?: (result: TOutput) => boolean,
) {
  return vValidator("json", schema, (result, c) => {
    if (debug.enabled && (!result.success || !filter || filter(result.output))) {
      c.req
        .text()
        .then(debug)
        .catch((error: unknown) => captureException(error));
    }
    if (!result.success) {
      setContext("validation", result);
      captureException(new Error("bad alchemy"));
      return c.json({ code: "bad request", legacy: "bad request" }, 400);
    }
  });
}
