import { vValidator } from "@hono/valibot-validator";
import { captureEvent, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext } from "@sentry/node";
import createDebug from "debug";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { array, notValues, nullish, number, object, picklist, pipe, string, transform, union, unknown } from "valibot";

import validatorHook from "../utils/validatorHook";
import verifySignature from "../utils/verifySignature";

const debug = createDebug("exa:sardine");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default function hook({ webhookSecret }: { webhookSecret: string }) {
  const app = new Hono().post(
    "/",
    validator("header", async ({ "x-sardine-signature": signature }, c) => {
      if (verifySignature({ signature, signingKey: webhookSecret, payload: await c.req.arrayBuffer() })) return;
      return c.json({ code: "unauthorized" }, 401);
    }),
    vValidator("json", Webhook, validatorHook({ code: "bad sardine", status: 200, debug })),
    (c) => {
      const payload = c.req.valid("json");
      setContext("sardine", { id: payload.id, type: payload.type });
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, `sardine.${payload.type}`);
      if (payload.case) {
        const { id, decision, linkedCustomers } = payload.data.caseDetails;
        captureEvent({
          message: `sardine ${payload.type}`,
          level: "warning",
          contexts: { sardine: { case: id, decision, customers: linkedCustomers } },
        });
        return c.json({ code: "ok" }, 200);
      }
      switch (payload.type) {
        case "alert.created":
        case "aml_screening_update.alerts":
          captureEvent({ message: `sardine ${payload.type}`, level: "warning" });
          return c.json({ code: "ok" }, 200);
        default:
          return c.json({ code: "ok" }, 200);
      }
    },
  );
  return { app, ready: Promise.resolve() };
}

const CaseEvents = ["case.created", "case.updated"] as const;

const Webhook = union([
  pipe(
    object({
      id: string(),
      type: picklist(CaseEvents),
      data: object({
        caseDetails: object({ id: number(), decision: nullish(string()), linkedCustomers: nullish(array(string())) }),
      }),
    }),
    transform((event) => ({ ...event, case: true as const })),
  ),
  pipe(
    object({ id: string(), type: pipe(string(), notValues(CaseEvents)), data: unknown() }),
    transform((event) => ({ ...event, case: false as const })),
  ),
]);
