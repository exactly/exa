import { vValidator } from "@hono/valibot-validator";
import { captureException, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, setUser } from "@sentry/node";
import { eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  array,
  check,
  integer,
  ip,
  isoTimestamp,
  literal,
  looseObject,
  minLength,
  minValue,
  nullable,
  number,
  object,
  optional,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  union,
} from "valibot";

import { Address } from "@exactly/common/validation";

import database, { cards, credentials } from "../database/index";
import { createUser, updateCard } from "../utils/panda";
import { addCapita, deriveAssociateId } from "../utils/pax";
import {
  addDocument,
  ADDRESS_TEMPLATE,
  CARD_LIMIT_CASE_TEMPLATE,
  CARD_LIMIT_TEMPLATE,
  CRYPTOMATE_TEMPLATE,
  getInquiryById,
  headerValidator,
  MANTECA_TEMPLATE_EXTRA_FIELDS,
  MANTECA_TEMPLATE_WITH_ID_CLASS,
  PANDA_TEMPLATE,
  updateCardLimit,
} from "../utils/persona";
import { customer } from "../utils/sardine";
import validatorHook from "../utils/validatorHook";

import type { InferOutput } from "valibot";
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
          payload: union([
            pipe(
              object({
                data: object({
                  id: string(),
                  attributes: object({
                    status: literal("approved"),
                    referenceId: string(),
                    emailAddress: string(),
                    phoneNumber: string(),
                    birthdate: string(),
                    nameFirst: string(),
                    nameMiddle: nullable(string()),
                    nameLast: string(),
                    addressStreet1: string(),
                    addressStreet2: nullable(string()),
                    addressCity: string(),
                    addressSubdivision: string(),
                    addressSubdivisionAbbr: nullable(string()),
                    addressPostalCode: string(),
                    fields: pipe(
                      object({
                        accountPurpose: object({ value: string() }),
                        annualSalary: object({ value: nullable(string()) }),
                        annualSalaryRangesUs150000: optional(object({ value: optional(string()) })),
                        expectedMonthlyVolume: object({ value: nullable(string()) }),
                        inputSelect: object({ value: string() }),
                        monthlyPurchasesRange: optional(object({ value: string() })),
                        addressCountryCode: object({ value: string() }),
                        birthdate: object({ value: string() }),
                        identificationNumber: object({ value: string() }),
                        nameFirst: object({ value: string() }),
                        nameLast: object({ value: string() }),
                        emailAddress: object({ value: string() }),
                        phoneNumber: optional(object({ value: string() })),
                        identificationClass: object({ value: string() }),
                        currentGovernmentId: object({ value: object({ id: string() }) }),
                        selectedCountryCode: object({ value: string() }),
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
                  relationships: object({
                    inquiryTemplate: object({
                      data: object({
                        id: literal(PANDA_TEMPLATE),
                      }),
                    }),
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
                      .toSorted((a, b) => a.attributes.createdAt.localeCompare(b.attributes.createdAt));
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
                  template: "panda" as const,
                  ...payload,
                  session,
                  annualSalary,
                  expectedMonthlyVolume,
                };
              }),
            ),
            pipe(
              object({
                data: object({
                  id: string(),
                  attributes: object({
                    status: literal("approved"),
                    referenceId: string(),
                    fields: object({
                      selectedCountryCode: object({ value: string() }),
                      currentGovernmentId1: object({ value: object({ id: string() }) }),
                      selectedIdClass1: object({ value: string() }),
                      identificationNumber: object({ value: string() }),
                    }),
                  }),
                  relationships: object({
                    inquiryTemplate: object({
                      data: object({
                        id: literal(MANTECA_TEMPLATE_WITH_ID_CLASS),
                      }),
                    }),
                  }),
                }),
              }),
              transform((payload) => ({ template: "manteca" as const, ...payload })),
            ),
            pipe(
              object({
                data: object({
                  type: literal("case"),
                  id: string(),
                  attributes: object({
                    status: picklist(["Approved", "Declined", "Open", "Pending"]),
                    fields: looseObject({
                      cardLimitUsd: optional(
                        object({ type: literal("integer"), value: nullable(pipe(number(), integer(), minValue(1))) }),
                      ),
                    }),
                  }),
                  relationships: object({
                    caseTemplate: object({ data: object({ id: literal(CARD_LIMIT_CASE_TEMPLATE) }) }),
                    inquiries: object({
                      data: array(object({ type: literal("inquiry"), id: string() })),
                    }),
                  }),
                }),
              }),
              transform((payload) => ({ template: "cardLimit" as const, ...payload })),
            ),
            pipe(
              object({
                data: object({
                  id: string(),
                  attributes: object({ status: string(), referenceId: string() }),
                  relationships: object({
                    inquiryTemplate: object({
                      data: object({
                        id: picklist([
                          ADDRESS_TEMPLATE,
                          CARD_LIMIT_TEMPLATE,
                          CRYPTOMATE_TEMPLATE,
                          MANTECA_TEMPLATE_EXTRA_FIELDS,
                        ]),
                      }),
                    }),
                  }),
                }),
              }),
              transform((payload) => ({ template: "ignored" as const, ...payload })),
            ),
          ]),
        }),
      }),
    }),
    validatorHook({ code: "bad persona", status: 200 }),
  ),
  async (c) => {
    const payload = c.req.valid("json").data.attributes.payload;

    if (payload.template === "ignored") return c.json({ code: "ok" }, 200);
    if (payload.template === "cardLimit") {
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.case.card-limit");
      if (payload.data.attributes.status !== "Approved") return c.json({ code: "ok" }, 200);
      const limitUsd = payload.data.attributes.fields.cardLimitUsd?.value;
      if (limitUsd == null) return c.json({ code: "no limit" }, 200);
      const inquiryId = payload.data.relationships.inquiries.data[0]?.id;
      if (!inquiryId) return c.json({ code: "no inquiry" }, 200);
      const referenceId = await getInquiryById(inquiryId).then((r) => r.data.attributes["reference-id"]);
      const credential = await database.query.credentials.findFirst({
        columns: { pandaId: true },
        where: eq(credentials.id, referenceId),
        with: { cards: { columns: { id: true }, where: inArray(cards.status, ["ACTIVE", "FROZEN"]), limit: 1 } },
      });
      if (credential?.pandaId && credential.cards[0]) {
        await updateCard({
          id: credential.cards[0].id,
          limit: { amount: limitUsd * 100, frequency: "per7DayPeriod" },
        });
      }
      await updateCardLimit(referenceId, limitUsd).catch((error: unknown) => {
        captureException(error, {
          level: "error",
          contexts: {
            cardLimitDrift: {
              referenceId,
              limitUsd,
              pandaId: credential.pandaId ?? null,
              cardId: credential.cards[0]?.id ?? null,
            },
          },
        });
        throw error;
      });
      if (!credential) {
        captureException(new Error("no credential"), { level: "error", contexts: { credential: { referenceId } } });
      }
      return c.json({ code: "ok" }, 200);
    }
    if (payload.template === "manteca") {
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry.manteca");
      await addDocument(payload.data.attributes.referenceId, {
        id_class: { value: payload.data.attributes.fields.selectedIdClass1.value },
        id_number: { value: payload.data.attributes.fields.identificationNumber.value },
        id_issuing_country: { value: payload.data.attributes.fields.selectedCountryCode.value },
        id_document_id: { value: payload.data.attributes.fields.currentGovernmentId1.value.id },
      });
      return c.json({ code: "ok" }, 200);
    }

    getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry");
    const {
      data: { id: personaShareToken, attributes },
      session,
      annualSalary,
      expectedMonthlyVolume,
    } = payload;
    const { referenceId, fields } = attributes;

    const credential = await database.query.credentials.findFirst({
      columns: { account: true, pandaId: true },
      where: eq(credentials.id, referenceId),
    });
    if (!credential) {
      captureException(new Error("no credential"), { level: "error", contexts: { credential: { referenceId } } });
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry.no-credential");
      return c.json({ code: "no credential" }, 200);
    }
    setUser({ id: credential.account });
    getActiveSpan()?.setAttribute("exa.inquiryId", personaShareToken);

    if (credential.pandaId) {
      getActiveSpan()?.setAttribute(SEMANTIC_ATTRIBUTE_SENTRY_OP, "persona.inquiry.already-created");
      return c.json({ code: "already created" }, 200);
    }

    const risk = await customer({
      flow: { name: "inquiry.approved", type: "account_update" },
      customer: {
        id: referenceId,
        type: "customer",
        firstName: attributes.nameFirst,
        lastName: attributes.nameLast,
        income: {
          amount:
            { " < US$ 30.000": 30_000, "US$ 30.000 - US$ 70.000": 70_000, "US$ 70.000 - US$ 150.000": 150_000 }[
              annualSalary
            ] ?? 300_000,
          currencyCode: "USD",
        },
        address: {
          street1: attributes.addressStreet1,
          city: attributes.addressCity,
          postalCode: attributes.addressPostalCode,
          countryCode: fields.addressCountryCode.value,
          ...(attributes.addressStreet2 && { street2: attributes.addressStreet2 }),
          ...(attributes.addressSubdivisionAbbr && { regionCode: attributes.addressSubdivisionAbbr }),
        },
        phone: attributes.phoneNumber.replaceAll(" ", ""),
        emailAddress: attributes.emailAddress,
        dateOfBirth: attributes.birthdate,
        tags: [
          {
            name: "expected_monthly_volume",
            value:
              { " < US$ 3000": 3000, "US$ 3.000 - US$ 7.000": 7000, "US$ 7.000 - US$ 15.000": 15_000 }[
                expectedMonthlyVolume
              ] ?? 30_000,
            type: "int",
          },
          {
            name: "source",
            value: "EXA",
            type: "string",
          },
        ],
        ...(attributes.nameMiddle && { middleName: attributes.nameMiddle }),
      },
      device: { ip: session.attributes.IPAddress },
    }).catch((error: unknown) => {
      captureException(error, { level: "error" });
    });

    if (risk) {
      getActiveSpan()?.setAttributes({ "exa.risk": risk.level, "exa.score": risk.customer?.score });
      if (risk.level === "very_high") return c.json({ code: "very high risk" }, 200);
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

    getActiveSpan()?.setAttributes({ "exa.pandaId": id });
    setContext("persona", { inquiryId: personaShareToken, pandaId: id });

    const account = safeParse(Address, credential.account);
    if (account.success) {
      addCapita({
        birthdate: fields.birthdate.value,
        document: fields.identificationNumber.value,
        firstName: fields.nameFirst.value,
        lastName: fields.nameLast.value,
        email: fields.emailAddress.value,
        phone: fields.phoneNumber?.value ?? "",
        internalId: deriveAssociateId(account.output),
        product: "travel insurance",
      }).catch((error: unknown) => {
        captureException(error, { level: "error", extra: { pandaId: id, referenceId } });
      });
    } else {
      captureException(new Error("invalid account address"), {
        extra: { pandaId: id, referenceId, account: credential.account },
        level: "error",
      });
    }
    addDocument(referenceId, {
      id_class: { value: fields.identificationClass.value },
      id_number: { value: fields.identificationNumber.value },
      id_issuing_country: { value: fields.selectedCountryCode.value },
      id_document_id: { value: fields.currentGovernmentId.value.id },
    }).catch((error: unknown) => {
      captureException(error, { level: "fatal", extra: { referenceId } });
    });

    return c.json({ id }, 200);
  },
);
