import { vValidator } from "@hono/valibot-validator";
import { captureEvent, setContext } from "@sentry/core";
import { captureException } from "@sentry/node";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "node:process";
import {
  array,
  boolean,
  flatten,
  literal,
  minValue,
  nullable,
  nullish,
  number,
  object,
  optional,
  picklist,
  pipe,
  safeParse,
  string,
  unknown,
  ValiError,
  type BaseIssue,
  type BaseSchema,
  type InferOutput,
} from "valibot";
import { baseSepolia, optimismSepolia } from "viem/chains";

import chain from "@exactly/common/generated/chain";

import appOrigin from "./appOrigin";
import ServiceError from "./ServiceError";

const DevelopmentChainIds = [baseSepolia.id, optimismSepolia.id] as const;

export const CARD_LIMIT_CASE_TEMPLATE = "ctmpl_5cCoj56PD6NpsX3H3ZoMynZVfXbF"; // cspell:ignore ctmpl_5cCoj56PD6NpsX3H3ZoMynZVfXbF
export const CARD_LIMIT_TEMPLATE = "itmpl_HSA4M3SwiH2wiWVpvFn4ny1kPws2"; // cspell:ignore itmpl_HSA4M3SwiH2wiWVpvFn4ny1kPws2
export const CRYPTOMATE_TEMPLATE = "itmpl_8uim4FvD5P3kFpKHX37CW817";
export const PANDA_TEMPLATE = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
export const MANTECA_TEMPLATE_EXTRA_FIELDS = "itmpl_gjYZshv7bc1DK8DNL8YYTQ1muejo";
export const MANTECA_TEMPLATE_WITH_ID_CLASS = "itmpl_TjaqJdQYkht17v645zNFUfkaWNan";
export const ADDRESS_TEMPLATE = "itmpl_FTHNSXqJjoMvUTBc85QECGHogrZx";

const PERSONA_API_VERSION = "2023-01-05";

export default function persona(key: string, url: string) {
  const provider = { key, url };
  return {
    addDocument: (referenceId: string, document: InferOutput<typeof IdentityDocument>) =>
      addDocument(referenceId, document, provider),
    createInquiry: (
      referenceId: string,
      templateId: string,
      redirectURI?: string,
      fields?: { "name-first": string; "name-last": string },
    ) => createInquiry(referenceId, templateId, redirectURI, fields, provider),
    getAccount: <T extends AccountScope>(referenceId: string, scope: T) => getAccount(referenceId, scope, provider),
    getCardLimitStatus: (referenceId: string, account?: UnknownAccountOutput) =>
      getCardLimitStatus(referenceId, account, provider),
    getDocument: (documentId: string) => getDocument(documentId, provider),
    getDocumentForManteca: (documents: InferOutput<typeof AccountBasicFields>["documents"]["value"], country: string) =>
      getDocumentForManteca(documents, country, provider),
    getInquiry: (referenceId: string, templateId: string) => getInquiry(referenceId, templateId, provider),
    getInquiryById: (id: string) => getInquiryById(id, provider),
    getPendingInquiryTemplate: (referenceId: string, scope: AccountScope) =>
      getPendingInquiryTemplate(referenceId, scope, provider),
    getUnknownAccount: (referenceId: string) => getUnknownAccount(referenceId, provider),
    resumeInquiry: (inquiryId: string) => resumeInquiry(inquiryId, provider),
    searchAccounts: (email: string) => searchAccounts(email, provider),
    updateCardLimit: (referenceId: string, limitUsd: number) => updateCardLimit(referenceId, limitUsd, provider),
  };
}

export async function getInquiry(referenceId: string, templateId: string, provider = getDefaultProvider()) {
  const { data: approvedInquiries } = await request(
    GetInquiriesResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[inquiry-template-id]=${templateId}&filter[status]=approved`,
    undefined,
    "GET",
    10_000,
    provider,
  );
  if (approvedInquiries[0]) return approvedInquiries[0];
  const { data: inquiries } = await request(
    GetInquiriesResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[inquiry-template-id]=${templateId}`,
    undefined,
    "GET",
    10_000,
    provider,
  );
  return inquiries[0];
}

export function getInquiryById(inquiryId: string, provider = getDefaultProvider()) {
  return request(
    object({ data: object({ attributes: object({ "reference-id": string() }) }) }),
    `/inquiries/${inquiryId}`,
    undefined,
    "GET",
    10_000,
    provider,
  );
}

export function resumeInquiry(inquiryId: string, provider = getDefaultProvider()) {
  return request(ResumeInquiryResponse, `/inquiries/${inquiryId}/resume`, undefined, "POST", 10_000, provider);
}

export function createInquiry(
  referenceId: string,
  templateId: string,
  redirectURI?: string,
  fields?: { "name-first": string; "name-last": string },
  provider = getDefaultProvider(),
) {
  return request(
    CreateInquiryResponse,
    "/inquiries",
    {
      data: {
        attributes: {
          "inquiry-template-id": templateId,
          "redirect-uri": `${redirectURI ?? appOrigin}/card`,
          ...(fields && { fields }),
        },
      },
      meta: { "auto-create-account": true, "auto-create-account-reference-id": referenceId },
    },
    "POST",
    10_000,
    provider,
  );
}

export async function getDocument(documentId: string, provider = getDefaultProvider()) {
  const { data } = await request(
    GetDocumentResponse,
    `/document/government-ids/${encodeURIComponent(documentId)}`,
    undefined,
    "GET",
    10_000,
    provider,
  );
  return data;
}

export async function addDocument(
  referenceId: string,
  identityDocument: InferOutput<typeof IdentityDocument>,
  provider = getDefaultProvider(),
) {
  const account = await getAccount(referenceId, "document", provider);
  if (!account) throw new Error("account not found");
  const existingDocument = account.attributes.fields.documents.value.find(
    (document) => document.value.id_document_id.value === identityDocument.id_document_id.value,
  );
  if (existingDocument) {
    captureEvent({ message: "document-already-exists", contexts: { id: existingDocument.value.id_document_id } });
    return;
  }
  return request(
    object({ data: object({ id: string() }) }),
    `/accounts/${account.id}`,
    {
      data: {
        attributes: {
          fields: {
            documents: [
              ...account.attributes.fields.documents.value.map((document) => ({
                id_class: document.value.id_class.value,
                id_number: document.value.id_number.value,
                id_issuing_country: document.value.id_issuing_country.value,
                id_document_id: document.value.id_document_id.value,
              })),
              {
                id_class: identityDocument.id_class.value,
                id_number: identityDocument.id_number.value,
                id_issuing_country: identityDocument.id_issuing_country.value,
                id_document_id: identityDocument.id_document_id.value,
              },
            ],
          },
        },
      },
    },
    "PATCH",
    10_000,
    provider,
  );
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  body?: unknown,
  method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
  provider = getDefaultProvider(),
) {
  const response = await fetch(`${provider.url}${url}`, {
    method,
    headers: {
      authorization: `Bearer ${provider.key}`,
      accept: "application/json",
      "content-type": "application/json",
      "persona-version": PERSONA_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new ServiceError("Persona", response.status, await response.text());
  const result = safeParse(schema, await response.json());
  if (!result.success) {
    setContext("validation", { ...result, flatten: flatten(result.issues) });
    throw new ValiError(result.issues);
  }
  return result.output;
}

export const IdentificationClasses = ["dl", "id", "pp", "pr", "rp", "visa", "wp"] as const;

const File = object({
  filename: string(),
  url: string(),
});

export const Document = object({
  id: string(),
  attributes: object({
    "back-photo": nullable(File),
    "front-photo": nullable(File),
    "selfie-photo": nullable(File),
    "id-class": string(),
  }),
});

export const GetDocumentResponse = object({ data: Document });

const AccountMantecaFields = object({
  isnotfacta: object({ value: boolean() }), // cspell:ignore isnotfacta
  tin: object({ value: string() }),
  sex_1: object({ value: picklist(["Male", "Female", "Prefer not to say"]) }),
  manteca_t_c: object({ value: boolean() }),
});

export const IdentityDocument = object({
  id_class: object({ value: string() }),
  id_number: object({ value: string() }),
  id_issuing_country: object({ value: string() }),
  id_document_id: object({ value: string() }),
});

const AccountBasicFields = object({
  name: object({
    value: object({
      first: object({ value: string() }),
      middle: object({ value: nullable(string()) }),
      last: object({ value: string() }),
    }),
  }),
  address: object({
    value: object({
      street_1: object({ value: string() }),
      street_2: object({ value: nullable(string()) }),
      city: object({ value: string() }),
      subdivision: object({ value: string() }),
      postal_code: object({ value: string() }),
      country_code: object({ value: string() }),
    }),
  }),
  birthdate: object({ value: string() }),
  phone_number: object({ value: string() }),
  email_address: object({ value: string() }),
  selfie_photo: object({ value: File }),
  rain_e_sign_consent: object({ value: boolean() }),
  exa_card_tc: object({ value: boolean() }),
  privacy__policy: object({ value: boolean() }),
  account_opening_disclosure: object({ value: nullable(boolean()) }),
  economic_activity: object({ value: string() }),
  annual_salary: object({ value: string() }),
  expected_monthly_volume: object({ value: string() }),
  accurate_info_confirmation: object({ value: boolean() }),
  non_unauthorized_solicitation: object({ value: boolean() }),
  non_illegal_activities_2: object({ value: picklist(["Yes", "No"]) }),
  documents: object({
    value: array(
      object({
        value: object({
          id_class: object({ value: string() }),
          id_number: object({ value: string() }),
          id_issuing_country: object({ value: string() }),
          id_document_id: object({ value: string() }),
        }),
      }),
    ),
  }),
});

const BaseAccountAttributes = object({
  fields: AccountBasicFields,
  "country-code": string(),
  "name-first": string(),
  "name-middle": nullable(string()),
  "name-last": string(),
  "address-street-1": string(),
  "address-street-2": nullable(string()),
  "address-city": string(),
  "address-subdivision": string(),
  "address-postal-code": string(),
  "social-security-number": nullable(string()),
  "phone-number": string(),
  "email-address": string(),
  birthdate: string(),
});

const BaseAccount = object({
  id: string(),
  type: literal("account"),
  attributes: BaseAccountAttributes,
});

const DocumentAccount = object({
  id: string(),
  type: literal("account"),
  attributes: object({
    fields: object({
      documents: object({ value: array(object({ value: IdentityDocument })) }),
    }),
  }),
});

const MantecaAccount = object({
  ...BaseAccount.entries,
  attributes: object({
    ...BaseAccountAttributes.entries,
    fields: object({ ...AccountBasicFields.entries, ...AccountMantecaFields.entries }),
  }),
});

const BridgeAccount = object({
  ...BaseAccount.entries,
  attributes: object({
    ...BaseAccountAttributes.entries,
    fields: object({
      ...AccountBasicFields.entries,
      bridge_enable: nullish(object({ value: nullable(boolean()) })),
    }),
  }),
});

const UnknownAccount = object({
  data: array(object({ id: string(), type: literal("account"), attributes: unknown() })),
});
export type UnknownAccountOutput = InferOutput<typeof UnknownAccount>;

const CardLimitAccount = object({
  id: string(),
  type: literal("account"),
  attributes: object({
    fields: object({ card_limit_usd: optional(object({ value: nullable(pipe(number(), minValue(1))) })) }),
  }),
});

const accountScopeSchemas = {
  bridge: object({ data: array(BridgeAccount) }),
  basic: object({ data: array(BaseAccount) }),
  manteca: object({ data: array(MantecaAccount) }),
  document: object({ data: array(DocumentAccount) }),
  cardLimit: object({ data: array(CardLimitAccount) }),
} as const;

export type AccountScope = keyof typeof accountScopeSchemas;
type AccountResponse<T extends AccountScope> = InferOutput<(typeof accountScopeSchemas)[T]>;
export type AccountOutput<T extends AccountScope> = AccountResponse<T>["data"][number];

export async function searchAccounts(email: string, provider = getDefaultProvider()) {
  const { data } = await request(
    object({ data: array(object({ attributes: object({ "reference-id": string() }) })) }),
    "/accounts/search",
    { query: { attribute: "fields.email_address", operator: "eq", value: email } },
    "POST",
    10_000,
    provider,
  );
  return data;
}

export function getAccounts<T extends AccountScope>(referenceId: string, scope: T, provider = getDefaultProvider()) {
  return request<unknown, AccountResponse<T>, BaseIssue<unknown>>(
    accountScopeSchemas[scope],
    `/accounts?page[size]=1&filter[reference-id]=${referenceId}`,
    undefined,
    "GET",
    10_000,
    provider,
  );
}

export async function getAccount<T extends AccountScope>(
  referenceId: string,
  scope: T,
  provider = getDefaultProvider(),
): Promise<AccountOutput<T> | undefined> {
  const { data } = await getAccounts(referenceId, scope, provider);
  return data[0];
}

export async function updateCardLimit(referenceId: string, limitUsd: number, provider = getDefaultProvider()) {
  const account = await getAccount(referenceId, "cardLimit", provider);
  if (!account) throw new Error("account not found");
  return request(
    object({ data: object({ id: string() }) }),
    `/accounts/${account.id}`,
    { data: { attributes: { fields: { card_limit_usd: limitUsd } } } },
    "PATCH",
    10_000,
    provider,
  );
}

export function parseAccount(unknownAccount: UnknownAccountOutput, scope: "basic"): AccountOutput<"basic"> | undefined;
export function parseAccount(
  unknownAccount: UnknownAccountOutput,
  scope: "cardLimit",
): AccountOutput<"cardLimit"> | undefined;
export function parseAccount<T extends AccountScope>(unknownAccount: UnknownAccountOutput, scope: T) {
  const result = safeParse(accountScopeSchemas[scope], unknownAccount);
  return result.success ? result.output.data[0] : undefined;
}

export async function getCardLimitStatus(
  referenceId: string,
  account?: UnknownAccountOutput,
  provider = getDefaultProvider(),
) {
  const unknownAccount =
    account ??
    (await getUnknownAccount(referenceId, provider).catch((error: unknown) => {
      captureException(error, { level: "error", contexts: { details: { referenceId, scope: "cardLimit" } } });
      throw error;
    }));
  if (parseAccount(unknownAccount, "cardLimit")?.attributes.fields.card_limit_usd?.value != null)
    return { status: "resolved" as const };
  if ((await evaluateAccount(unknownAccount, "cardLimit", provider)) !== CARD_LIMIT_TEMPLATE)
    return { status: "noTemplate" as const };
  const inquiry = await getInquiry(referenceId, CARD_LIMIT_TEMPLATE, provider);
  if (!inquiry) return { status: "noInquiry" as const };
  return { status: inquiry.attributes.status, id: inquiry.id };
}

export function getUnknownAccount(referenceId: string, provider = getDefaultProvider()) {
  return request(
    UnknownAccount,
    `/accounts?page[size]=1&filter[reference-id]=${referenceId}`,
    undefined,
    "GET",
    10_000,
    provider,
  );
}

export async function getPendingInquiryTemplate(
  referenceId: string,
  scope: AccountScope,
  provider = getDefaultProvider(),
) {
  const unknownAccount = await getUnknownAccount(referenceId, provider);
  return evaluateAccount(unknownAccount, scope, provider);
}

export async function evaluateAccount(
  unknownAccount: InferOutput<typeof UnknownAccount>,
  scope: AccountScope,
  provider = getDefaultProvider(),
): Promise<
  | typeof CARD_LIMIT_TEMPLATE
  | typeof MANTECA_TEMPLATE_EXTRA_FIELDS
  | typeof MANTECA_TEMPLATE_WITH_ID_CLASS
  | typeof PANDA_TEMPLATE
  | undefined
> {
  switch (scope) {
    case "document":
      throw new Error("document account scope not supported");
    case "cardLimit":
      return (await evaluateAccount(unknownAccount, "basic", provider)) ?? CARD_LIMIT_TEMPLATE;
    case "basic": {
      const result = safeParse(accountScopeSchemas[scope], unknownAccount);
      if (!result.success) {
        const notMissingFieldsIssues = result.issues.filter((issue) => !isMissingOrNull(issue));
        if (notMissingFieldsIssues.length === 0) return PANDA_TEMPLATE;

        setContext("validation", { ...result, flatten: flatten(result.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
      }
      if (!result.output.data[0]) return PANDA_TEMPLATE;
      return;
    }
    case "manteca": {
      const requiredTemplate = await evaluateAccount(unknownAccount, "basic", provider);
      // TODO use an unified template for panda + manteca
      if (requiredTemplate) return requiredTemplate;

      const basicAccount = safeParse(accountScopeSchemas.basic, unknownAccount);
      if (!basicAccount.success) {
        setContext("validation", { ...basicAccount, flatten: flatten(basicAccount.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
      }

      const countryCode = basicAccount.output.data[0]?.attributes["country-code"];
      if (!countryCode) throw new Error(scopeValidationErrors.INVALID_ACCOUNT);
      const allowedIds = getAllowedMantecaIds(countryCode);
      if (!allowedIds) throw new Error(scopeValidationErrors.NOT_SUPPORTED);

      const documents = basicAccount.output.data[0]?.attributes.fields.documents.value ?? [];
      const validDocument = await getValidDocumentForManteca(documents, allowedIds, provider);
      const hasValidDocument = validDocument !== undefined;

      const result = safeParse(accountScopeSchemas[scope], unknownAccount);
      if (!result.success) {
        const notMissingFieldsIssues = result.issues.filter((issue) => !isMissingOrNull(issue));
        if (notMissingFieldsIssues.length === 0) {
          return hasValidDocument ? MANTECA_TEMPLATE_EXTRA_FIELDS : MANTECA_TEMPLATE_WITH_ID_CLASS;
        }
        setContext("validation", { ...result, flatten: flatten(result.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
      }
      if (!hasValidDocument) return MANTECA_TEMPLATE_WITH_ID_CLASS;

      return;
    }
    case "bridge": {
      const requiredTemplate = await evaluateAccount(unknownAccount, "basic");
      if (requiredTemplate) return requiredTemplate;

      const bridgeAccount = safeParse(accountScopeSchemas.bridge, unknownAccount);
      if (!bridgeAccount.success) {
        setContext("validation", { ...bridgeAccount, flatten: flatten(bridgeAccount.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
      }

      if (!getDocumentForBridge(bridgeAccount.output.data[0]?.attributes.fields.documents.value ?? [])) {
        throw new Error(scopeValidationErrors.NOT_SUPPORTED);
      }

      return;
    }
    default: {
      const exhaustive: never = scope;
      throw new Error(`unhandled account scope: ${exhaustive as string}`);
    }
  }
}

export const Inquiry = object({
  id: string(),
  type: literal("inquiry"),
  attributes: object({
    status: picklist(["created", "pending", "expired", "failed", "needs_review", "declined", "completed", "approved"]),
    "reference-id": string(),
  }),
});

const GetInquiriesResponse = object({
  data: array(Inquiry),
});
const ResumeInquiryResponse = object({
  data: object({
    id: string(),
    type: literal("inquiry"),
  }),
  meta: object({ "session-token": string() }),
});
const CreateInquiryResponse = object({
  data: object({
    id: string(),
    type: literal("inquiry"),
    attributes: object({ status: literal("created"), "reference-id": string() }),
  }),
});

export function headerValidator(secret = getWebhookSecret()) {
  return vValidator("header", object({ "persona-signature": string() }), async (r, c) => {
    if (!r.success) return c.text("bad request", 400);
    const body = await c.req.text();
    const t = r.output["persona-signature"].split(",")[0]?.split("=")[1];
    const hmac = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const isVerified = r.output["persona-signature"]
      .split(" ")
      .map((pair) => pair.split("v1=")[1])
      .filter((s) => s !== undefined)
      .some((signature) => {
        return timingSafeEqual(Buffer.from(hmac), Buffer.from(signature));
      });
    return isVerified ? undefined : c.text("unauthorized", 401);
  });
}

export function isMissingOrNull<TInput>(issue: BaseIssue<TInput>): boolean {
  if (issue.kind === "schema" && (issue.received === "null" || issue.input === undefined)) return true;
  if (issue.kind === "validation" && issue.type === "min_length" && issue.received === "0") return true;
  return issue.issues?.every((subIssue) => isMissingOrNull(subIssue)) ?? false;
}

export const MantecaCountryCode = ["AR", "CL", "BR", "CO", "PA", "CR", "GT", "MX", "PH", "BO"] as const;

type IdClass = (typeof IdentificationClasses)[number];
type Country = (typeof MantecaCountryCode)[number];
type AllowedIdConfig = { id: IdClass; side: "both" | "front" };
type Allowed = { allowedIds: readonly AllowedIdConfig[] };
const allowedMantecaCountries = new Map<Country, Allowed>([
  [
    "AR",
    {
      allowedIds: [
        { id: "id", side: "both" },
        { id: "pp", side: "front" },
      ],
    },
  ],
  [
    "BR",
    {
      allowedIds: [
        { id: "dl", side: "both" },
        { id: "pp", side: "front" },
        { id: "id", side: "both" },
      ],
    },
  ],
] satisfies (readonly [Country, Allowed])[]);

function isDevelopment(): boolean {
  return DevelopmentChainIds.includes(chain.id as (typeof DevelopmentChainIds)[number]);
}

export function getAllowedMantecaIds(country: string): readonly AllowedIdConfig[] | undefined {
  if (isDevelopment()) {
    return (
      allowedMantecaCountries.get(country as Country)?.allowedIds ??
      { US: [{ id: "dl", side: "front" }] as const }[country]
    );
  }
  const result = safeParse(picklist(MantecaCountryCode), country);
  if (!result.success) return undefined;
  return allowedMantecaCountries.get(result.output)?.allowedIds;
}

export async function getValidDocumentForManteca(
  documents: InferOutput<typeof AccountBasicFields>["documents"]["value"],
  allowedIds: readonly AllowedIdConfig[],
  provider = getDefaultProvider(),
): Promise<InferOutput<typeof IdentityDocument> | undefined> {
  for (const { id: idClass, side } of allowedIds) {
    const classDocuments = documents.filter(({ value: { id_class } }) => id_class.value === idClass);
    if (classDocuments.length === 0) continue;
    for (const document of classDocuments.toReversed()) {
      if (side === "front") return document.value;
      const { attributes } = await getDocument(document.value.id_document_id.value, provider);
      if (attributes["front-photo"] && attributes["back-photo"]) {
        return document.value;
      }
    }
  }

  return undefined;
}

export async function getDocumentForManteca(
  documents: InferOutput<typeof AccountBasicFields>["documents"]["value"],
  country: string,
  provider = getDefaultProvider(),
): Promise<InferOutput<typeof IdentityDocument> | undefined> {
  const allowedIds = getAllowedMantecaIds(country);
  if (!allowedIds) return undefined;
  return getValidDocumentForManteca(documents, allowedIds, provider);
}

export const BridgeIdentityDocumentType = [
  "drivers_license",
  "matriculate_id",
  "military_id",
  "national_id",
  "passport",
  "permanent_residency_id",
  "state_or_provincial_id",
  "visa",
] as const;

export const IdClassToBridge: Record<
  (typeof IdentificationClasses)[number],
  (typeof BridgeIdentityDocumentType)[number] | undefined
> = {
  id: "national_id",
  pp: "passport",
  dl: "drivers_license",
  wp: undefined,
  rp: undefined,
  pr: "permanent_residency_id",
  visa: "visa",
};

export function getDocumentForBridge(documents: InferOutput<typeof AccountBasicFields>["documents"]["value"]) {
  const classDocuments = documents.filter(({ value: { id_class } }) => {
    const result = safeParse(picklist(IdentificationClasses), id_class.value);
    return result.success && IdClassToBridge[result.output];
  });
  if (classDocuments.length === 0) return;
  return classDocuments.at(-1)?.value;
}

export const scopeValidationErrors = {
  INVALID_SCOPE_VALIDATION: "invalid scope validation",
  INVALID_ACCOUNT: "invalid account",
  NOT_SUPPORTED: "not supported",
} as const;

function getDefaultProvider(): Provider {
  if (!env.PERSONA_API_KEY) throw new Error("missing persona api key");
  if (!env.PERSONA_URL) throw new Error("missing persona url");
  return { key: env.PERSONA_API_KEY, url: env.PERSONA_URL };
}

function getWebhookSecret() {
  if (!env.PERSONA_WEBHOOK_SECRET) throw new Error("missing persona webhook secret");
  return env.PERSONA_WEBHOOK_SECRET;
}

type Provider = { key: string; url: string };
