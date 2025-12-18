import chain from "@exactly/common/generated/chain";
import { vValidator } from "@hono/valibot-validator";
import { setContext } from "@sentry/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  array,
  type BaseIssue,
  type BaseSchema,
  type InferOutput,
  flatten,
  literal,
  nullable,
  boolean,
  number,
  object,
  picklist,
  safeParse,
  string,
  ValiError,
} from "valibot";

import appOrigin from "./appOrigin";
import type { CountryCode } from "./ramps/manteca";
import { DevelopmentChainId } from "./ramps/shared";

if (!process.env.PERSONA_API_KEY) throw new Error("missing persona api key");
if (!process.env.PERSONA_URL) throw new Error("missing persona url");
if (!process.env.PERSONA_WEBHOOK_SECRET) throw new Error("missing persona webhook secret");

export const CRYPTOMATE_TEMPLATE = "itmpl_8uim4FvD5P3kFpKHX37CW817";
export const PANDA_TEMPLATE = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";
export const MANTECA_TEMPLATE_EXTRA_FIELDS = "itmpl_gjYZshv7bc1DK8DNL8YYTQ1muejo";
export const MANTECA_TEMPLATE_WITH_ID_CLASS = "itmpl_rQsZej9uirAbHermNgtkqf9GetgX";

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

export async function getApprovedInquiry(referenceId: string) {
  const { data: approvedInquiries } = await request(
    GetInquiriesResponse,
    `/inquiries?page[size]=1&filter[reference-id]=${referenceId}&filter[status]=approved`,
  );
  return approvedInquiries[0];
}

export function resumeInquiry(inquiryId: string) {
  return request(ResumeInquiryResponse, `/inquiries/${inquiryId}/resume`, undefined, "POST");
}

export function redactAccount(accountId: string) {
  return request(object({ data: object({ id: string() }) }), `/accounts/${accountId}`, RedactAccount, "PATCH");
}

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
        exa_card_tc: {
          value: "",
        },
        rain_e_sign_consent: {
          value: "",
        },
        // TODO review persona api error on this field
        identification_numbers: {
          type: "array",
          value: [],
        },
      },
    },
  },
};

export function createInquiry(referenceId: string, redirectURI?: string) {
  return request(CreateInquiryResponse, "/inquiries", {
    data: { attributes: { "inquiry-template-id": PANDA_TEMPLATE, "redirect-uri": `${redirectURI ?? appOrigin}/card` } },
    meta: { "auto-create-account": true, "auto-create-account-reference-id": referenceId },
  });
}

export function createInquiryFromTemplate(referenceId: string, templateId: string, redirectURI?: string) {
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
  method: "GET" | "POST" | "PUT" | "PATCH" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: { authorization, accept: "application/json", "content-type": "application/json" },
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

const Document = object({
  filename: nullable(string()),
  url: nullable(string()),
  "byte-size": nullable(number()),
});

export const Documents = object({
  id: string(),
  attributes: object({
    "back-photo": nullable(Document),
    "front-photo": nullable(Document),
    "selfie-photo": nullable(Document),
    "id-class": string(),
  }),
});

export const GetDocumentResponse = object({ data: Documents });

const AccountMantecaFields = object({
  // these are custom fields, if we change the name in the inquiry template we need to update it here
  isnotfacta: object({ type: literal("boolean"), value: boolean() }), // cspell:ignore isnotfacta
  tin: object({ type: literal("string"), value: string() }),
  sex_1: object({ type: string(), value: picklist(["Male", "Female", "Prefer not to say"]) }),
  manteca_t_c: object({ type: literal("boolean"), value: boolean() }),
});

const BaseAccountAttributes = object({ "country-code": string() });

const BaseAccount = object({
  id: string(),
  type: literal("account"),
  attributes: BaseAccountAttributes,
});

const MantecaAccount = object({
  ...BaseAccount.entries,
  attributes: object({ ...BaseAccountAttributes.entries, fields: AccountMantecaFields }),
});

const UnknownAccount = object({
  data: array(object({ id: string(), attributes: object({ "reference-id": nullable(string()) }) })),
  links: object({ next: nullable(string()) }),
});

const accountScopeSchemas = {
  basic: object({ data: array(BaseAccount) }),
  manteca: object({ data: array(MantecaAccount) }),
} as const;

export type AccountScope = keyof typeof accountScopeSchemas;
type AccountResponse<T extends AccountScope> = InferOutput<(typeof accountScopeSchemas)[T]>;
type AccountOutput<T extends AccountScope> = AccountResponse<T>["data"][number];

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

/** Evaluates if the account is valid for the given scope. Returns the template id to collect missing fields if any. */
function evaluateAccount(
  unknownAccount: InferOutput<typeof UnknownAccount>,
  scope: AccountScope,
): typeof PANDA_TEMPLATE | typeof MANTECA_TEMPLATE_EXTRA_FIELDS | typeof MANTECA_TEMPLATE_WITH_ID_CLASS | undefined {
  switch (scope) {
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
      // TODO get id class from account
      const userIdClass = "dl";
      if (!countryCode) throw new Error(scopeValidationErrors.ACCOUNT_NOT_CREATED);
      const allowedIds = getAllowedMantecaIds(countryCode);
      if (!allowedIds) throw new Error(scopeValidationErrors.NOT_SUPPORTED);

      const result = safeParse(accountScopeSchemas[scope], unknownAccount);
      if (!result.success) {
        const notMissingFieldsIssues = result.issues.filter((issue) => !isMissingOrNull(issue));
        if (notMissingFieldsIssues.length === 0) {
          return allowedIds.includes(userIdClass) ? MANTECA_TEMPLATE_EXTRA_FIELDS : MANTECA_TEMPLATE_WITH_ID_CLASS;
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

/** Recursively check if the issue is due to a missing field or with null value */
export function isMissingOrNull<TInput>(issue: BaseIssue<TInput>): boolean {
  return (
    (issue.kind === "schema" && (issue.received === "null" || issue.input === undefined)) ||
    (issue.issues?.every((subIssue) => isMissingOrNull(subIssue)) ?? false)
  );
}

type DevelopmentChain = (typeof DevelopmentChainId)[number];
type IdClass = (typeof IdentificationClasses)[number];
type Country = (typeof CountryCode)[number];
interface Allowed {
  allowedIds: readonly IdClass[];
}
const allowedMantecaCountries = new Map<Country, Allowed>([
  ["AR", { allowedIds: ["id", "pp"] }],
  ["BR", { allowedIds: ["id", "dl", "pp"] }],
  ...(DevelopmentChainId.includes(chain.id as DevelopmentChain)
    ? ([["US", { allowedIds: ["dl"] }]] as const)
    : ([] as const)),
] satisfies (readonly [Country, Allowed])[]);

export function getAllowedMantecaIds(country: string): readonly IdClass[] | undefined {
  return allowedMantecaCountries.get(country as Country)?.allowedIds;
}

export const scopeValidationErrors = {
  INVALID_SCOPE_VALIDATION: "invalid scope validation",
  ACCOUNT_NOT_CREATED: "account not created",
  NOT_SUPPORTED: "not supported",
} as const;
