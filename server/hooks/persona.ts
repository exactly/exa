import { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureException, getActiveSpan, SEMANTIC_ATTRIBUTE_SENTRY_OP, setContext, setUser } from "@sentry/node";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { InferOutput } from "valibot";
import {
  array,
  check,
  ip,
  isoTimestamp,
  literal,
  looseObject,
  minLength,
  nullable,
  object,
  optional,
  parse,
  pipe,
  safeParse,
  string,
  transform,
  union,
} from "valibot";

import database, { credentials } from "../database/index";
import keeper from "../utils/keeper";
import { createUser } from "../utils/panda";
import { addCapita, deriveAssociateId } from "../utils/pax";
import { addDocument, headerValidator, MANTECA_TEMPLATE_WITH_ID_CLASS, PANDA_TEMPLATE } from "../utils/persona";
import { customer } from "../utils/sardine";
import validatorHook from "../utils/validatorHook";
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

const Panda = pipe(
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
      template: "panda" as const,
      ...payload,
      session,
      annualSalary,
      expectedMonthlyVolume,
    };
  }),
);

const Manteca = pipe(
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
);

export default new Hono().post(
  "/",
  headerValidator(),
  vValidator(
    "json",
    object({
      data: object({
        attributes: object({
          payload: union([Panda, Manteca]),
        }),
      }),
    }),
    validatorHook({ code: "bad persona", status: 200 }),
  ),
  async (c) => {
    const payload = c.req.valid("json").data.attributes.payload;

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
      captureException(new Error("no credential"), { contexts: { credential: { referenceId } } });
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
      getActiveSpan()?.setAttributes({ "exa.risk": risk.level });
      getActiveSpan()?.setAttributes({ "exa.score": risk.customer?.score });
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

    const associateId = deriveAssociateId(parse(Address, credential.account));
    getActiveSpan()?.setAttributes({ "exa.pandaId": id });
    setContext("persona", { inquiryId: personaShareToken, pandaId: id });

    const capitaPayload = {
      birthdate: attributes.birthdate,
      document: fields.identificationNumber.value,
      firstName: attributes.nameFirst,
      lastName: attributes.nameLast,
      email: attributes.emailAddress,
      phone: attributes.phoneNumber,
      internalId: associateId,
      product: "travel insurance",
    };
    setContext("pax", { payload: capitaPayload });
    addCapita(capitaPayload).catch((error: unknown) => {
      captureException(error, { extra: { pandaId: id, referenceId } });
    });

    if (firewallAddress) {
      keeper
        .exaSend(
          { name: "exa.firewall", op: "exa.firewall", attributes: { account: credential.account, personaShareToken } },
          { address: firewallAddress, functionName: "allow", args: [credential.account, true], abi: firewallAbi },
        )
        .catch((error: unknown) => captureException(error, { level: "error" }));
    }
    addDocument(referenceId, {
      id_class: { value: fields.identificationClass.value },
      id_number: { value: fields.identificationNumber.value },
      id_issuing_country: { value: fields.selectedCountryCode.value },
      id_document_id: { value: fields.currentGovernmentId.value.id },
    }).catch((error: unknown) => {
      // in case of an error we will need to update the account manually
      captureException(error, { extra: { referenceId }, level: "fatal" });
    });

    return c.json({ id }, 200);
  },
);
