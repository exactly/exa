import { setContext } from "@sentry/node";
import {
  flatten,
  minLength,
  nullable,
  object,
  optional,
  pipe,
  record,
  safeParse,
  string,
  transform,
  trim,
  unknown,
  type GenericSchema,
  type InferOutput,
} from "valibot";

import { BUSINESS_TEMPLATE, FieldValue, isMissingOrNull } from "./persona";

import type createPersona from "./persona";

export async function businessProfile(credentialId: string, persona: ReturnType<typeof createPersona>) {
  const inquiry = await persona.getInquiry(credentialId, BUSINESS_TEMPLATE);
  if (!inquiry) throw new BusinessApplicationError("business inquiry not started", "not started");
  if (inquiry.attributes["reference-id"] !== credentialId)
    throw new BusinessApplicationError("business inquiry does not match credential", "bad request");
  switch (inquiry.attributes.status) {
    case "created":
    case "expired":
    case "pending":
      throw new BusinessApplicationError("business inquiry is not started", "not started");
    case "failed":
    case "declined":
      throw new BusinessApplicationError("business inquiry failed", "bad kyb");
    case "needs_review":
      throw new BusinessApplicationError("business inquiry is not complete", "processing");
    case "approved":
    case "completed":
      break;
  }
  const account = await persona.getAccount(credentialId, "business");
  if (!account) throw new BusinessApplicationError("business account not started", "not started");
  const accountResult = safeParse(BusinessAccount, account.attributes);
  if (!accountResult.success || accountResult.output["reference-id"] !== credentialId)
    throw new BusinessApplicationError("business account is not complete", "processing");
  const fields = accountResult.output.fields;
  for (const [inquiryName, inquiryField] of Object.entries(inquiry.attributes.fields ?? {})) {
    const name = inquiryName.replaceAll("-", "_");
    if (isBlank(fields[name]?.value) && !isBlank(inquiryField.value)) fields[name] = inquiryField;
  }
  const { collected_email_address, i_company_name } = requireFields(BusinessProfileFields, fields);
  return { email: collected_email_address, fields, name: i_company_name };
}

export function requireFields<TSchema extends GenericSchema>(schema: TSchema, input: unknown): InferOutput<TSchema> {
  const result = safeParse(schema, input);
  if (result.success) return result.output;
  if (result.issues.filter((issue) => !isMissingOrNull(issue)).length === 0)
    throw new BusinessApplicationError("business account is not complete", "processing");
  setContext("validation", { flatten: flatten(result.issues) });
  throw new BusinessApplicationError("invalid business Persona fields", "bad request");
}

export function toAddress(fields: InferOutput<typeof BusinessApplicationFields>, suffix: "" | "_1" = "") {
  return {
    line1: fields[`street_1${suffix}`],
    line2: fields[`street_2${suffix}`],
    city: fields[`city${suffix}`],
    region: fields[`subdivision${suffix}`],
    postalCode: fields[`postal_code${suffix}`],
    countryCode: fields[`country_code${suffix}`],
  };
}

function isBlank(value: unknown) {
  return value == null || (typeof value === "string" && value.trim().length === 0);
}

const RequiredField = pipe(
  object({ value: unknown() }),
  transform((field) => field.value),
  string(),
  trim(),
  minLength(1),
);

const OptionalField = optional(
  pipe(
    object({ value: optional(nullable(string())) }),
    transform((field) => {
      const value = field.value?.trim();
      return value === "" ? undefined : value;
    }),
  ),
);

const BusinessProfileFields = object({
  collected_email_address: RequiredField,
  i_company_name: RequiredField,
});

export const BusinessApplicationFields = object({
  company_description: RequiredField,
  company_industry: RequiredField,
  company_registration_number: RequiredField,
  company_tax_id: RequiredField,
  company_website: RequiredField,
  i_auth_user_name: RequiredField,
  i_auth_user_last_name: RequiredField,
  birth_date: RequiredField,
  id_number: RequiredField,
  id_country: RequiredField,
  street_1: RequiredField,
  street_1_1: RequiredField,
  street_2: OptionalField,
  street_2_1: OptionalField,
  city: RequiredField,
  city_1: RequiredField,
  subdivision: RequiredField,
  subdivision_1: RequiredField,
  postal_code: RequiredField,
  postal_code_1: RequiredField,
  country_code: RequiredField,
  country_code_1: RequiredField,
});

const BusinessAccount = object({
  "reference-id": string(),
  fields: record(string(), FieldValue),
});

export const businessCodes = ["bad kyb", "bad request", "not started", "processing"] as const;

export class BusinessApplicationError extends Error {
  constructor(
    message: string,
    readonly code: (typeof businessCodes)[number],
  ) {
    super(message);
  }
}
