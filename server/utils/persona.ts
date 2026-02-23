import { vValidator } from "@hono/valibot-validator";
import { captureEvent, setContext } from "@sentry/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  array,
  boolean,
  check,
  flatten,
  literal,
  looseObject,
  nullable,
  nullish,
  object,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
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

export async function getUnknownApprovedInquiry(referenceId: string, templateId?: string) {
  const { data: approvedInquiries } = await request(
    GetUnknownApprovedInquiryResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[status]=approved${templateId ? `&filter[inquiry-template-id]=${templateId}` : ""}`,
  );
  return approvedInquiries[0];
}

export function resumeInquiry(inquiryId: string) {
  return request(ResumeInquiryResponse, `/inquiries/${inquiryId}/resume`, undefined, "POST");
}

export function redactAccount(accountId: string) {
  return request(object({ data: object({ id: string() }) }), `/accounts/${accountId}`, RedactAccount, "PATCH");
}

export function updateAccount(accountId: string, attributes: InferOutput<typeof UpdateAccountAttributes>) {
  return request(
    object({ data: object({ id: string() }) }),
    `/accounts/${accountId}`,
    {
      data: {
        attributes,
      },
    },
    "PATCH",
  );
}

export const UpdateAccountAttributes = object({
  fields: object({
    exa_card_tc: boolean(),
    rain_e_sign_consent: boolean(),
    privacy__policy: boolean(),
    account_opening_disclosure: nullable(boolean()),
    economic_activity: string(),
    annual_salary: string(),
    expected_monthly_volume: string(),
    accurate_info_confirmation: boolean(),
    non_unauthorized_solicitation: boolean(),
    non_illegal_activities_2: picklist(["Yes", "No"]),
    address: object({
      value: object({
        street_1: string(),
        street_2: nullable(string()),
        city: string(),
        subdivision: nullable(string()),
        postal_code: string(),
        country_code: string(),
      }),
    }),
  }),
  "address-street-1": string(),
  "address-street-2": nullable(string()),
  "address-city": string(),
  "address-subdivision": nullable(string()),
  "address-postal-code": string(),
  "country-code": string(),
});

const RedactAccount = {
  data: {
    attributes: {
      "country-code": "",
      "identification-numbers": "",
      "phone-number": "",
      "email-address": "",
      birthdate: "",
      "name-first": "",
      "name-middle": "",
      "name-last": "",
      "address-street-1": "",
      "address-street-2": "",
      "address-city": "",
      "address-subdivision": "",
      "address-postal-code": "",
      "social-security-number": "",
      fields: {
        exa_card_tc: "",
        rain_e_sign_consent: "",
        privacy__policy: "",
        account_opening_disclosure: "",
        address: {
          street_1: "",
          street_2: "",
          city: "",
          subdivision: "",
          postal_code: "",
          country_code: "",
        },
        selfie_photo: "",
        documents: [],
      },
    },
  },
};

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
  data: array(looseObject({ id: string(), attributes: looseObject({ "reference-id": nullable(string()) }) })),
  links: object({ next: nullable(string()) }),
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

export function getUnknownAccounts(limit = 1, after?: string, referenceId?: string) {
  return request(
    UnknownAccount,
    `/accounts?page[size]=${limit}${after ? `&page[after]=${after}` : ""}${referenceId ? `&filter[reference-id]=${referenceId}` : ""}`,
  );
}

export async function getPendingInquiryTemplate(referenceId: string, scope: AccountScope): Promise<string | undefined> {
  const unknownAccount = await getUnknownAccount(referenceId);
  return evaluateAccount(unknownAccount, scope);
}

export function evaluateAccount(
  unknownAccount: InferOutput<typeof UnknownAccount>,
  scope: AccountScope,
): typeof MANTECA_TEMPLATE_EXTRA_FIELDS | typeof MANTECA_TEMPLATE_WITH_ID_CLASS | typeof PANDA_TEMPLATE | undefined {
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
      const requiredTemplate = evaluateAccount(unknownAccount, "basic");
      // TODO use an unified template for panda + manteca
      if (requiredTemplate) return requiredTemplate;

      const basicAccount = safeParse(accountScopeSchemas.basic, unknownAccount);
      if (!basicAccount.success) {
        setContext("validation", { ...basicAccount, flatten: flatten(basicAccount.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
      }

      const countryCode = basicAccount.output.data[0]?.attributes["country-code"];
      const userIdClasses = basicAccount.output.data[0]?.attributes.fields.documents.value.map(
        (document) => document.value.id_class.value,
      );
      if (!userIdClasses?.length) throw new Error(scopeValidationErrors.INVALID_ACCOUNT);
      if (!countryCode) throw new Error(scopeValidationErrors.INVALID_ACCOUNT);
      const allowedIds = getAllowedMantecaIds(countryCode);
      if (!allowedIds) throw new Error(scopeValidationErrors.NOT_SUPPORTED);

      const result = safeParse(accountScopeSchemas[scope], unknownAccount);
      if (!result.success) {
        const notMissingFieldsIssues = result.issues.filter((issue) => !isMissingOrNull(issue));
        if (notMissingFieldsIssues.length === 0) {
          return allowedIds.some((id) => userIdClasses.includes(id))
            ? MANTECA_TEMPLATE_EXTRA_FIELDS
            : MANTECA_TEMPLATE_WITH_ID_CLASS;
        }
        setContext("validation", { ...result, flatten: flatten(result.issues) });
        throw new Error(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
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
    "redacted-at": nullable(string()),
  }),
  relationships: object({
    "inquiry-template": nullable(object({ data: object({ id: string() }) })),
  }),
});

export const UnknownInquiry = object({
  id: string(),
  type: literal("inquiry"),
  attributes: looseObject({
    status: literal("approved"),
    "reference-id": string(),
    "redacted-at": nullable(string()),
    fields: unknown(),
  }),
  relationships: object({
    "inquiry-template": nullable(object({ data: object({ id: string() }) })),
  }),
});

export const PandaInquiryApproved = object({
  id: string(),
  type: literal("inquiry"),
  attributes: object({
    status: literal("approved"),
    "reference-id": string(),
    "redacted-at": nullable(string()),
    // "address-street-1": string(),
    // "address-street-2": nullable(string()),
    // "address-city": string(),
    // "address-subdivision": string(),
    // "address-postal-code": string(),
    // "address-country-code": string(),
    fields: pipe(
      object({
        // common
        "input-checkbox": object({ value: boolean() }), // rain e sign consent
        "new-screen-input-checkbox": object({ value: boolean() }), // privacy policy
        "new-screen-input-checkbox-1": object({ value: boolean() }), // info accurate
        "new-screen-input-checkbox-3": object({ value: boolean() }), // unauthorized solicitation
        "new-screen-2-2-input-checkbox": nullish(object({ value: nullable(boolean()) })), // exa card tc

        // US
        "new-screen-input-checkbox-4": nullish(object({ value: nullable(boolean()) })), // account opening disclosure
        "new-screen-input-checkbox-2": nullish(object({ value: nullable(boolean()) })), // exa card tc legacy

        "identification-class": object({ value: string() }),
        "identification-number": object({ value: string() }),
        "selected-country-code": object({ value: string() }),
        "current-government-id": object({ value: object({ id: string() }) }),

        "input-select": object({ value: string() }), // economic activity

        "account-purpose": object({ value: string() }),
        "illegal-activites": object({ value: picklist(["Yes", "No"]) }), // cspell:ignore illegal-activites

        // fallback for missing fields
        "annual-salary-ranges-us-150-000": nullish(object({ value: nullable(string()) })),
        "annual-salary": nullish(object({ value: nullable(string()) })),

        "monthly-purchases-range": nullish(object({ value: nullable(string()) })),
        "expected-monthly-volume": nullish(object({ value: nullable(string()) })),

        "address-street-1": object({ value: string() }),
        "address-street-2": object({ value: nullable(string()) }),
        "address-city": object({ value: string() }),
        "address-subdivision": object({ value: nullable(string()) }),
        "address-postal-code": object({ value: string() }),
        "address-country-code": object({ value: string() }),
      }),
      transform((fields) => {
        if (!fields["new-screen-2-2-input-checkbox"]?.value && !fields["new-screen-input-checkbox-2"]?.value) {
          // eslint-disable-next-line no-console
          console.error(
            "❌ exa card tc is required, either new-screen-2-2-input-checkbox or new-screen-input-checkbox-2 must be true, setting new-screen-input-checkbox-2 to true",
          );
          return { ...fields, "new-screen-input-checkbox-2": { value: true } };
        }
        return fields;
      }),
      check(
        (fields) => !!fields["annual-salary"]?.value || !!fields["annual-salary-ranges-us-150-000"]?.value,
        "either annual-salary or annual-salary-ranges-us-150-000 must have a value",
      ),
      check(
        (fields) => !!fields["expected-monthly-volume"]?.value || !!fields["monthly-purchases-range"]?.value,
        "either expected-monthly-volume or monthly-purchases-range must have a value",
      ),
    ),
  }),
  relationships: object({
    "inquiry-template": nullable(object({ data: object({ id: string() }) })),
  }),
});

const GetUnknownApprovedInquiryResponse = object({
  data: array(UnknownInquiry),
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

export const MantecaCountryCode = [
  "AR",
  "CL",
  "BR",
  "CO",
  "PA",
  "CR",
  "GT",
  "MX",
  "PH",
  "BO",

  // TODO for testing, remove
  "US",
] as const;

type DevelopmentChain = (typeof DevelopmentChainIds)[number];
type IdClass = (typeof IdentificationClasses)[number];
type Country = (typeof MantecaCountryCode)[number];
type Allowed = { allowedIds: readonly IdClass[] };
const allowedMantecaCountries = new Map<Country, Allowed>([
  ["AR", { allowedIds: ["id", "pp"] }],
  ["BR", { allowedIds: ["id", "dl", "pp"] }],
  ...(DevelopmentChainIds.includes(chain.id as DevelopmentChain)
    ? ([["US", { allowedIds: ["dl"] }]] as const)
    : ([] as const)),
] satisfies (readonly [Country, Allowed])[]);

export function getAllowedMantecaIds(country: string): readonly IdClass[] | undefined {
  return allowedMantecaCountries.get(country as Country)?.allowedIds;
}

export const scopeValidationErrors = {
  INVALID_SCOPE_VALIDATION: "invalid scope validation",
  INVALID_ACCOUNT: "invalid account",
  NOT_SUPPORTED: "not supported",
} as const;
