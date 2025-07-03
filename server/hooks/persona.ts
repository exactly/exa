import { vValidator } from "@hono/valibot-validator";
import { captureException, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { InferOutput } from "valibot";
import {
  array,
  check,
  flatten,
  ip,
  isoTimestamp,
  literal,
  looseObject,
  minLength,
  nullable,
  object,
  optional,
  pipe,
  safeParse,
  string,
  transform,
} from "valibot";

import database, { credentials } from "../database/index";
import { createUser } from "../utils/panda";
import { headerValidator } from "../utils/persona";

const Session = pipe(
  object({
    type: literal("inquiry-session"),
    attributes: object({ createdAt: pipe(string(), isoTimestamp()), ipAddress: pipe(string(), ip()) }),
  }),
  transform((x) => {
    return {
      ...x,
      attributes: {
        createdAt: x.attributes.createdAt,
        IPAddress: x.attributes.ipAddress,
      },
    };
  }),
);

export default new Hono().post(
  "/",
  headerValidator(),
  vValidator(
    "json",
    object({
      data: object({
        attributes: object({
          payload: pipe(
            object({
              data: object({
                id: string(),
                attributes: object({
                  status: literal("approved"),
                  referenceId: string(),
                  fields: pipe(
                    object({
                      accountPurpose: object({ value: string() }),
                      annualSalary: object({ value: nullable(string()) }),
                      annualSalaryRangesUs150000: optional(object({ value: optional(string()) })),
                      expectedMonthlyVolume: object({ value: nullable(string()) }),
                      inputSelect: object({ value: string() }),
                      monthlyPurchasesRange: optional(object({ value: string() })),
                    }),
                    check(
                      (fields) => !!fields.annualSalaryRangesUs150000?.value || !!fields.annualSalary.value,
                      "Either annualSalary or annualSalaryRangesUs150000 must have a value",
                    ),
                    check(
                      (fields) => !!fields.monthlyPurchasesRange?.value || !!fields.expectedMonthlyVolume.value,
                      "Either monthlyPurchasesRange or expectedMonthlyVolume must have a value",
                    ),
                  ),
                }),
              }),
              included: pipe(
                array(looseObject({ type: string() })),
                minLength(1),
                transform((incl) => {
                  return incl
                    .reduce<InferOutput<typeof Session>[]>((sessions, item) => {
                      const s = safeParse(Session, item);
                      if (s.success) return [...sessions, s.output];
                      return sessions;
                    }, [])
                    .sort((a, b) => a.attributes.createdAt.localeCompare(b.attributes.createdAt));
                }),
                minLength(1),
              ),
            }),
            transform((payload) => {
              if (payload.included.length === 0) throw new Error("no valid sessions");
              const session = payload.included[0];
              if (!session) throw new Error("no valid session");

              const annualSalary =
                payload.data.attributes.fields.annualSalaryRangesUs150000?.value ??
                payload.data.attributes.fields.annualSalary.value;
              const expectedMonthlyVolume =
                payload.data.attributes.fields.monthlyPurchasesRange?.value ??
                payload.data.attributes.fields.expectedMonthlyVolume.value;

              if (!expectedMonthlyVolume) throw new Error("no monthly volume");
              if (!annualSalary) throw new Error("no annual salary");

              return {
                ...payload,
                session,
                annualSalary,
                expectedMonthlyVolume,
              };
            }),
          ),
        }),
      }),
    }),
    (validation, c) => {
      if (!validation.success) {
        captureException(new Error("bad persona"), {
          contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
        });
        return c.json(
          validation.issues.map((issue) => `${issue.path?.map((p) => p.key).join("/")} ${issue.message}`),
          200,
        );
      }
    },
  ),
  async (c) => {
    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry");
    const {
      data: {
        id: personaShareToken,
        attributes: { fields, referenceId },
      },
      session,
      annualSalary,
      expectedMonthlyVolume,
    } = c.req.valid("json").data.attributes.payload;

    const credential = await database.query.credentials.findFirst({
      columns: { account: true, pandaId: true },
      where: eq(credentials.id, referenceId),
    });
    if (!credential) {
      captureException(new Error("no credential"), { contexts: { credential: { referenceId } } });
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry.no-credential");
      return c.json({ code: "no credential" }, 200);
    }
    setUser({ id: credential.account });
    setContext("persona", { inquiryId: personaShareToken });

    if (credential.pandaId) {
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry.already-created");
      return c.json({ code: "already created" }, 200);
    }

    // TODO implement error handling to return 200 if event should not be retried
    const { id } = await createUser({
      accountPurpose: fields.accountPurpose.value,
      annualSalary,
      expectedMonthlyVolume,
      ipAddress: session.attributes.IPAddress,
      isTermsOfServiceAccepted: true,
      occupation: fields.inputSelect.value,
      personaShareToken,
    });

    await database.update(credentials).set({ pandaId: id }).where(eq(credentials.id, referenceId));

    setContext("persona", { inquiryId: personaShareToken, pandaId: id });

    return c.json({ id }, 200);
  },
);
