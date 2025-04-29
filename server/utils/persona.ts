import { vValidator } from "@hono/valibot-validator";
import { setContext } from "@sentry/core";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  array,
  type BaseIssue,
  type BaseSchema,
  flatten,
  literal,
  nullable,
  object,
  picklist,
  safeParse,
  string,
  ValiError,
  variant,
} from "valibot";

import appOrigin from "./appOrigin";

if (!process.env.PERSONA_API_KEY) throw new Error("missing persona api key");
if (!process.env.PERSONA_TEMPLATE_ID) throw new Error("missing persona template id");
if (!process.env.PERSONA_URL) throw new Error("missing persona url");
if (!process.env.PERSONA_WEBHOOK_SECRET) throw new Error("missing persona webhook secret");

export const CRYPTOMATE_TEMPLATE = "itmpl_8uim4FvD5P3kFpKHX37CW817";
export const PANDA_TEMPLATE = "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2";

const authorization = `Bearer ${process.env.PERSONA_API_KEY}`;
const baseURL = process.env.PERSONA_URL;
const webhookSecret = process.env.PERSONA_WEBHOOK_SECRET;

export async function getAccount(referenceId: string) {
  const { data: accounts } = await request(
    GetAccountsResponse,
    `/accounts?page[size]=1&filter[reference-id]=${referenceId}`,
  );
  return accounts[0];
}

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

export function createInquiry(referenceId: string) {
  return request(CreateInquiryResponse, "/inquiries", {
    data: { attributes: { "inquiry-template-id": PANDA_TEMPLATE, "redirect-uri": `${appOrigin}/card` } },
    meta: { "auto-create-account": true, "auto-create-account-reference-id": referenceId },
  });
}

export function generateOTL(inquiryId: string) {
  return request(GenerateOTLResponse, `/inquiries/${inquiryId}/generate-one-time-link`, undefined, "POST");
}

async function request<TInput, TOutput, TIssue extends BaseIssue<unknown>>(
  schema: BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  body?: unknown,
  method: "GET" | "POST" = body === undefined ? "GET" : "POST",
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

const GetAccountsResponse = object({
  data: array(
    object({
      id: string(),
      type: literal("account"),
      attributes: object({ "country-code": nullable(string(), "unknown") }),
    }),
  ),
});

const GetInquiriesResponse = object({
  data: array(
    object({
      id: string(),
      type: literal("inquiry"),
      attributes: variant("status", [
        object({
          status: picklist(["completed", "approved"]),
          "reference-id": string(),
          "name-first": string(),
          "name-middle": nullable(string()),
          "name-last": string(),
          "email-address": string(),
          "phone-number": string(),
        }),
        object({
          status: picklist(["created", "pending", "expired", "failed", "needs_review", "declined"]),
          "reference-id": string(),
          "name-first": nullable(string()),
          "name-middle": nullable(string()),
          "name-last": nullable(string()),
          "email-address": nullable(string()),
          "phone-number": nullable(string()),
        }),
      ]),
    }),
  ),
});
const ResumeInquiryResponse = object({
  data: object({
    id: string(),
    type: literal("inquiry"),
    attributes: object({
      status: picklist([
        "created",
        "pending",
        "expired",
        "failed",
        "needs_review",
        "declined",
        "completed",
        "approved",
      ]),
      "reference-id": string(),
      fields: object({
        "name-first": object({ type: literal("string"), value: nullable(string()) }),
        "name-middle": object({ type: literal("string"), value: nullable(string()) }),
        "name-last": object({ type: literal("string"), value: nullable(string()) }),
        "email-address": object({ type: literal("string"), value: nullable(string()) }),
        "phone-number": object({ type: literal("string"), value: nullable(string()) }),
      }),
    }),
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
