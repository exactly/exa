import { vValidator } from "@hono/valibot-validator";
import { captureEvent, setContext } from "@sentry/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  array,
  boolean,
  flatten,
  literal,
  nullable,
  object,
  picklist,
  safeParse,
  string,
  unknown,
  ValiError,
  type BaseIssue,
  type BaseSchema,
  type InferOutput,
} from "valibot";

import chain from "@exactly/common/generated/chain";

import appOrigin from "./appOrigin";
import { DevelopmentChainIds } from "./ramps/shared";

if (!process.env.PERSONA_API_KEY) throw new Error("missing persona api key");
if (!process.env.PERSONA_URL) throw new Error("missing persona url");
if (!process.env.PERSONA_WEBHOOK_SECRET) throw new Error("missing persona webhook secret");

export const CRYPTOMATE_TEMPLATE = "itmpl_8uim4FvD5P3kFpKHX37CW817";
export const PANDA_TEMPLATE = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
export const MANTECA_TEMPLATE_EXTRA_FIELDS = "itmpl_gjYZshv7bc1DK8DNL8YYTQ1muejo";
export const MANTECA_TEMPLATE_WITH_ID_CLASS = "itmpl_TjaqJdQYkht17v645zNFUfkaWNan";

const PERSONA_API_VERSION = "2023-01-05";

const authorization = `Bearer ${process.env.PERSONA_API_KEY}`;
const baseURL = process.env.PERSONA_URL;
const webhookSecret = process.env.PERSONA_WEBHOOK_SECRET;

export async function getInquiry(referenceId: string, templateId: string) {
  const { data: approvedInquiries } = await request(
    GetInquiriesResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[inquiry-template-id]=${templateId}&filter[status]=approved`,
  );
  if (approvedInquiries[0]) return approvedInquiries[0];
  const { data: inquiries } = await request(
    GetInquiriesResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[inquiry-template-id]=${templateId}`,
  );
  return inquiries[0];
}

export function resumeInquiry(inquiryId: string) {
  return request(ResumeInquiryResponse, `/inquiries/${inquiryId}/resume`, undefined, "POST");
}

export function createInquiry(referenceId: string, templateId: string, redirectURI?: string) {
  return request(CreateInquiryResponse, "/inquiries", {
    data: { attributes: { "inquiry-template-id": templateId, "redirect-uri": `${redirectURI ?? appOrigin}/card` } },
    meta: { "auto-create-account": true, "auto-create-account-reference-id": referenceId },
  });
}

export function generateOTL(inquiryId: string) {
  return request(GenerateOTLResponse, `/inquiries/${inquiryId}/generate-one-time-link`, undefined, "POST");
}

export async function getDocument(documentId: string) {
  const { data } = await request(GetDocumentResponse, `/document/government-ids/${documentId}`);
  return data;
}

export async function addDocument(referenceId: string, identityDocument: InferOutput<typeof IdentityDocument>) {
  const account = await getAccount(referenceId, "document");
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
  );
}

export async function resumeOrCreateMantecaInquiryOTL(referenceId: string, redirectURL?: string): Promise<string> {
  const { data: inquiries } = await request(
    GetMantecaInquiryResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[inquiry-template-id]=${MANTECA_TEMPLATE_EXTRA_FIELDS}&filter[status]=created,pending`,
  );

  if (inquiries[0]) {
    const { meta } = await generateOTL(inquiries[0].id);
    return meta["one-time-link"];
  }

  // TODO prefill inquiry with known fields
  const { data } = await request(CreateInquiryResponse, `/inquiries`, {
    data: {
      attributes: {
        "inquiry-template-id": MANTECA_TEMPLATE_EXTRA_FIELDS,
        "redirect-uri": `${redirectURL ?? appOrigin}/`,
      },
    },
    meta: { "auto-create-account-reference-id": referenceId },
  });
  const { meta } = await generateOTL(data.id);
  return meta["one-time-link"];
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  body?: unknown,
  method: "GET" | "PATCH" | "POST" | "PUT" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      authorization,
      accept: "application/json",
      "content-type": "application/json",
      "persona-version": PERSONA_API_VERSION,
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });
  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const result = safeParse(schema, await response.json());
  if (!result.success) {
    setContext("validation", { ...result, flatten: flatten(result.issues) });
    throw new ValiError(result.issues);
  }
  return result.output;
}

export const IdentificationClasses = ["pp", "dl", "id", "wp", "rp"] as const;

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

const UnknownAccount = object({
  data: array(object({ id: string(), type: literal("account"), attributes: unknown() })),
});

const accountScopeSchemas = {
  basic: object({ data: array(BaseAccount) }),
  manteca: object({ data: array(MantecaAccount) }),
  document: object({ data: array(DocumentAccount) }),
} as const;

export type AccountScope = keyof typeof accountScopeSchemas;
type AccountResponse<T extends AccountScope> = InferOutput<(typeof accountScopeSchemas)[T]>;
export type AccountOutput<T extends AccountScope> = AccountResponse<T>["data"][number];

export function getAccounts<T extends AccountScope>(referenceId: string, scope: T): Promise<AccountResponse<T>> {
  return request(accountScopeSchemas[scope], `/accounts?page[size]=1&filter[reference-id]=${referenceId}`);
}

export async function getAccount<T extends AccountScope>(
  referenceId: string,
  scope: T,
): Promise<AccountOutput<T> | undefined> {
  const { data } = await getAccounts(referenceId, scope);
  return data[0];
}

function getUnknownAccount(referenceId: string) {
  return request(UnknownAccount, `/accounts?page[size]=1&filter[reference-id]=${referenceId}`);
}

export async function getPendingInquiryTemplate(
  referenceId: string,
  scope: AccountScope,
): Promise<Awaited<ReturnType<typeof evaluateAccount>>> {
  const unknownAccount = await getUnknownAccount(referenceId);
  return evaluateAccount(unknownAccount, scope);
}

export async function evaluateAccount(
  unknownAccount: InferOutput<typeof UnknownAccount>,
  scope: AccountScope,
): Promise<
  typeof MANTECA_TEMPLATE_EXTRA_FIELDS | typeof MANTECA_TEMPLATE_WITH_ID_CLASS | typeof PANDA_TEMPLATE | undefined
> {
  switch (scope) {
    case "document":
      throw new Error("document account scope not supported");
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
      const requiredTemplate = await evaluateAccount(unknownAccount, "basic");
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
      const validDocument = await getValidDocumentForManteca(documents, allowedIds);
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
const GenerateOTLResponse = object({
  data: object({
    id: string(),
    type: literal("inquiry"),
    attributes: object({ status: string(), "reference-id": string() }),
  }),
  meta: object({ "one-time-link": string(), "one-time-link-short": string() }),
});

const MantecaInquiry = object({
  id: string(),
  type: literal("inquiry"),
  attributes: object({ status: picklist(["completed", "pending", "created", "expired"]), "reference-id": string() }),
});

const GetMantecaInquiryResponse = object({ data: array(MantecaInquiry) });

export function headerValidator() {
  return vValidator("header", object({ "persona-signature": string() }), async (r, c) => {
    if (!r.success) return c.text("bad request", 400);
    const body = await c.req.text();
    const t = r.output["persona-signature"].split(",")[0]?.split("=")[1];
    const hmac = createHmac("sha256", webhookSecret).update(`${t}.${body}`).digest("hex");
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
): Promise<InferOutput<typeof IdentityDocument> | undefined> {
  for (const { id: idClass, side } of allowedIds) {
    const document = documents.find(({ value: { id_class } }) => id_class.value === idClass);
    if (!document) continue;
    if (side === "front") return document.value;
    const { attributes } = await getDocument(document.value.id_document_id.value);
    if (attributes["front-photo"] && attributes["back-photo"]) {
      return document.value;
    }
  }

  return undefined;
}

export async function getDocumentForManteca(
  documents: InferOutput<typeof AccountBasicFields>["documents"]["value"],
  country: string,
): Promise<InferOutput<typeof IdentityDocument> | undefined> {
  const allowedIds = getAllowedMantecaIds(country);
  if (!allowedIds) return undefined;
  return getValidDocumentForManteca(documents, allowedIds);
}

export const scopeValidationErrors = {
  INVALID_SCOPE_VALIDATION: "invalid scope validation",
  INVALID_ACCOUNT: "invalid account",
  NOT_SUPPORTED: "not supported",
} as const;
