import * as v from "valibot";

import { baseURL, key as api_key } from "./panda";

export async function submitApplication(payload: v.InferInput<typeof SubmitApplicationRequest>) {
  return request(ApplicationResponse, "/issuing/applications/user", {}, payload, "POST");
}

export async function getApplicationStatus(applicationId: string) {
  return request(ApplicationStatusResponse, `/issuing/applications/user/${applicationId}`, {}, undefined, "GET");
}

export async function updateApplication(applicationId: string, payload: v.InferInput<typeof UpdateApplicationRequest>) {
  return request(v.object({}), `/issuing/applications/user/${applicationId}`, {}, payload, "PATCH");
}

// #region schemas
const AddressSchema = v.object({
  line1: v.pipe(v.string(), v.minLength(1), v.maxLength(100)),
  line2: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(100))),
  city: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
  region: v.pipe(v.string(), v.minLength(1), v.maxLength(50)),
  country: v.optional(v.pipe(v.string(), v.minLength(1), v.maxLength(50))),
  postalCode: v.pipe(v.string(), v.minLength(1), v.maxLength(15), v.regex(/^[a-z0-9]{1,15}$/i)),
  countryCode: v.pipe(v.string(), v.length(2), v.regex(/^[A-Z]{2}$/i)),
});

export const SubmitApplicationRequest = v.object({
  email: v.pipe(
    v.string(),
    v.email("Invalid email address"),
    v.metadata({ description: "Email address", examples: ["user@domain.com"] }),
  ),
  lastName: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The person's last name" })),
  firstName: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The person's first name" })),
  nationalId: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The person's national ID" })),
  birthDate: v.pipe(
    v.string(),
    v.regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD format"),
    v.check((value) => {
      const date = new Date(value);
      return !Number.isNaN(date.getTime());
    }, "must be a valid date"),
    v.metadata({ description: "Birth date (YYYY-MM-DD)", examples: ["1970-01-01"] }),
  ),
  countryOfIssue: v.pipe(
    v.string(),
    v.length(2),
    v.regex(/^[A-Z]{2}$/i, "Must be exactly 2 letters"),
    v.metadata({ description: "The person's country of issue of their national id, as a 2-digit country code" }),
  ),
  phoneCountryCode: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(3),
    v.regex(/^\d{1,3}$/, "Must be a valid country code"),
    v.metadata({ description: "The user's phone country code" }),
  ),
  phoneNumber: v.pipe(
    v.string(),
    v.minLength(1),
    v.maxLength(15),
    v.regex(/^\d{1,15}$/, "Must be a valid phone number"),
    v.metadata({ description: "The user's phone number" }),
  ),
  address: v.pipe(AddressSchema, v.metadata({ description: "The person's address" })),
  ipAddress: v.pipe(
    v.union([v.pipe(v.string(), v.maxLength(50), v.ipv4()), v.pipe(v.string(), v.maxLength(50), v.ipv6())]),
    v.metadata({ description: "The user's IP address (IPv4 or IPv6)" }),
  ),
  occupation: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The user's occupation" })),
  annualSalary: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The user's annual salary" })),
  accountPurpose: v.pipe(v.string(), v.maxLength(50), v.metadata({ description: "The user's account purpose" })),
  expectedMonthlyVolume: v.pipe(
    v.string(),
    v.maxLength(50),
    v.metadata({ description: "The user's expected monthly volume" }),
  ),
  isTermsOfServiceAccepted: v.pipe(
    v.boolean(),
    v.literal(true),
    v.metadata({ description: "Whether the user has accepted the terms of service" }),
  ),
});

export const UpdateApplicationRequest = v.object({
  ...v.partial(v.omit(SubmitApplicationRequest, ["email", "phoneCountryCode", "phoneNumber", "address"])).entries,
  address: v.optional(AddressSchema),
});

const ApplicationResponse = v.object({
  id: v.pipe(v.string(), v.maxLength(50)),
  applicationStatus: v.pipe(v.string(), v.maxLength(50)),
});

export const kycStatus = [
  "needsVerification",
  "needsInformation",
  "manualReview",
  "notStarted",
  "approved",
  "canceled",
  "pending",
  "denied",
  "locked",
] as const;

const ApplicationStatusResponse = v.object({
  id: v.string(),
  applicationStatus: v.picklist(kycStatus),
  applicationReason: v.optional(v.string()),
});
// #endregion schemas

async function request<TInput, TOutput, TIssue extends v.BaseIssue<unknown>>(
  schema: v.BaseSchema<TInput, TOutput, TIssue>,
  url: `/${string}`,
  headers = {},
  body?: unknown,
  method: "GET" | "POST" | "PUT" | "PATCH" = body === undefined ? "GET" : "POST",
  timeout = 10_000,
) {
  const response = await fetch(`${baseURL}${url}`, {
    method,
    headers: {
      ...headers,
      "Api-Key": api_key,
      accept: "application/json",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeout),
  });

  if (!response.ok) throw new Error(`${response.status} ${await response.text()}`);
  const rawBody = await response.arrayBuffer();
  if (rawBody.byteLength === 0) return v.parse(schema, {});
  return v.parse(schema, JSON.parse(new TextDecoder().decode(rawBody)));
}
