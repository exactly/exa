import { captureException, setContext, setUser, startSpan } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as honoOpenapi from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import {
  array,
  fallback,
  flatten,
  is,
  literal,
  maxLength,
  metadata,
  minLength,
  nullable,
  nullish,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  safeParse,
  string,
  transform,
  trim,
  union,
} from "valibot";
import { sha256, verifyMessage } from "viem";
import { parseSiweMessage } from "viem/siwe";

import accountInit from "@exactly/common/accountInit";
import chain, {
  exaAccountFactoryAddress,
  exaPluginAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { Address, Hex } from "@exactly/common/validation";

import { credentials, walletAddresses } from "../database/schema";
import { origin } from "../utils/appOrigin";
import decodePublicKey from "../utils/decodePublicKey";
import { Application, UpdateApplicationRequest as ApplicationUpdate, BusinessApplicationError } from "../utils/panda";
import {
  BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE,
  BUSINESS_TEMPLATE,
  CARD_LIMIT_TEMPLATE,
  CRYPTOMATE_TEMPLATE,
  PANDA_BUSINESS_CHECKBOX_TEMPLATE,
  PANDA_TEMPLATE,
  parseAccount,
  scopeValidationErrors,
} from "../utils/persona";
import publicClient from "../utils/publicClient";
import { IpAddress } from "../utils/sardine";
import ServiceError from "../utils/ServiceError";
import validatorHook from "../utils/validatorHook";

import type * as schema from "../database/schema";
import type { Auth } from "../middleware/auth";
import type createPanda from "../utils/panda";
import type createPersona from "../utils/persona";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const canonicalize = import("canonicalize").then(({ default: serialize }) => serialize);

const KYCStatusResponse = object({
  code: pipe(string(), metadata({ examples: ["ok"] })),
  legacy: pipe(string(), metadata({ examples: ["ok"] })),
  reason: pipe(string(), metadata({ examples: ["", "BAD_SELFIE"] })),
  status: pipe(string(), metadata({ examples: ["approved", "denied"] })),
});

const BadRequestCodes = {
  ALREADY_STARTED: "already started",
  NOT_STARTED: "not started",
  BAD_REQUEST: "bad request",
} as const;

const businessSteps = [PANDA_BUSINESS_CHECKBOX_TEMPLATE, BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE] as const;

function buildBaseResponse(example = "string") {
  return object({
    code: pipe(string(), metadata({ examples: [example] })),
    legacy: pipe(string(), metadata({ examples: [example] })),
  });
}

export default function route({
  auth,
  database,
  panda,
  persona,
}: {
  auth: Auth;
  database: NodePgDatabase<typeof schema>;
  panda: ReturnType<typeof createPanda>;
  persona: ReturnType<typeof createPersona>;
}) {
  return new Hono()
    .get(
      "/",
      auth,
      vValidator(
        "query",
        object({
          countryCode: optional(literal("true")),
          scope: optional(picklist(["basic", "bridge", "business", "cardLimit", "manteca", "panda-business"])),
        }),
        validatorHook(),
      ),
      async (c) => {
        const scope = c.req.valid("query").scope ?? "basic";

        const { credentialId } = c.req.valid("cookie");
        const credential = await database.query.credentials.findFirst({
          columns: { id: true, account: true, pandaId: true, factory: true, publicKey: true, salt: true },
          where: eq(credentials.id, credentialId),
        });
        if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);

        const account = parse(Address, credential.account);
        setUser({ id: account });
        setContext("exa", { credential });

        if (scope === "panda-business") {
          const application = await panda.getCompanyApplication(credentialId);
          if (!application) return c.json({ code: BadRequestCodes.NOT_STARTED }, 400);
          const status = application.applicationStatus ?? "unknown";
          let code = "processing";
          if (status === "approved") code = "ok";
          else if (status === "denied" || status === "locked" || status === "canceled") code = "bad kyb";
          const state = {
            code,
            completionLink: application.applicationCompletionLink ?? undefined,
            reason: application.applicationReason ?? "unknown",
            status,
            verificationLink: application.applicationExternalVerificationLink ?? undefined,
          };
          if (state.code !== "ok") return c.json(state, state.code === "bad kyb" ? 400 : 200);
          for (const template of businessSteps) {
            const inquiry = await persona.getInquiry(credentialId, template);
            if (!inquiry) return c.json({ code: BadRequestCodes.NOT_STARTED }, 400);
            switch (inquiry.attributes.status) {
              case "approved":
                break;
              case "created":
              case "pending":
              case "expired":
                return c.json({ code: BadRequestCodes.NOT_STARTED }, 400);
              case "completed":
              case "needs_review":
                return c.json({ code: "processing" }, 400);
              case "failed":
              case "declined":
                return c.json({ code: "bad kyc" }, 400);
              default:
                throw new Error("unknown inquiry status");
            }
          }
          return c.json(state, 200);
        }

        if (scope === "cardLimit") {
          const unknownAccount = c.req.valid("query").countryCode
            ? await persona.getUnknownAccount(credentialId).catch((error: unknown): undefined => {
                captureException(error, {
                  level: "error",
                  contexts: { details: { credentialId, scope: "cardLimit" } },
                });
              })
            : undefined;
          if (unknownAccount) {
            const countryCode = parseAccount(unknownAccount, "basic")?.attributes["country-code"];
            countryCode && c.header("User-Country", countryCode);
          }
          const cardLimit = await persona.getCardLimitStatus(credentialId, unknownAccount);

          switch (cardLimit.status) {
            case "resolved":
              return c.json({ code: "ok" }, 200);
            case "approved":
              captureException(new Error("inquiry approved but account not updated"), {
                level: "error",
                contexts: { inquiry: { templateId: CARD_LIMIT_TEMPLATE, referenceId: credentialId } },
              });
              return c.json({ code: "ok" }, 200);
            case "noTemplate":
              return c.json({ code: "no kyc" }, 400);
            case "noInquiry":
            case "created":
            case "pending":
            case "expired":
              return c.json({ code: "not started" }, 400);
            case "completed":
            case "needs_review":
              return c.json({ code: "processing" }, 400);
            case "failed":
            case "declined":
              return c.json({ code: "bad kyc" }, 400);
            default:
              throw new Error("unknown inquiry status");
          }
        }

        if (scope === "basic" && credential.pandaId) {
          if (c.req.valid("query").countryCode) {
            const personaAccount = await persona.getAccount(credentialId, scope).catch((error: unknown) => {
              captureException(error, { level: "error", contexts: { details: { credentialId, scope } } });
            });
            const countryCode = personaAccount?.attributes["country-code"];
            countryCode && c.header("User-Country", countryCode);
          }
          return c.json({ code: "ok", legacy: "ok" }, 200);
        }

        if (await isLegacy(credentialId, account, credential.factory, credential.publicKey, credential.salt, persona)) {
          return c.json({ code: "legacy kyc", legacy: "legacy kyc" }, 200);
        }

        let inquiryTemplateId: Awaited<ReturnType<(typeof persona)["getPendingInquiryTemplate"]>>;
        try {
          inquiryTemplateId = await persona.getPendingInquiryTemplate(credentialId, scope);
        } catch (error: unknown) {
          if (error instanceof Error && error.message === scopeValidationErrors.NOT_SUPPORTED) {
            return c.json({ code: "not supported" }, 400);
          }
          throw error;
        }
        if (!inquiryTemplateId) {
          if (c.req.valid("query").countryCode) {
            const personaAccount = await persona.getAccount(credentialId, scope).catch((error: unknown) => {
              captureException(error, { level: "error", contexts: { details: { credentialId, scope } } });
            });
            const attributes = personaAccount?.attributes;
            const countryCode = attributes && "country-code" in attributes ? attributes["country-code"] : undefined;
            countryCode && c.header("User-Country", countryCode);
          }
          return c.json({ code: "ok", legacy: "ok" }, 200);
        }
        const inquiry = await persona.getInquiry(credentialId, inquiryTemplateId);
        if (!inquiry) return c.json({ code: "not started", legacy: "kyc not started" }, 400);
        switch (inquiry.attributes.status) {
          case "approved":
            captureException(new Error("inquiry approved but account not updated"), {
              level: "error",
              contexts: { inquiry: { templateId: inquiryTemplateId, referenceId: credentialId } },
            });
            return c.json({ code: "ok", legacy: "ok" }, 200);
          case "created":
          case "pending":
          case "expired":
            return c.json({ code: "not started", legacy: "kyc not started" }, 400);
          case "completed":
          case "needs_review":
            return c.json({ code: "processing", legacy: "kyc not approved" }, 400);
          case "failed":
          case "declined":
            return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 400);
          default:
            throw new Error("unknown inquiry status");
        }
      },
    )
    .post(
      "/",
      auth,
      vValidator(
        "header",
        optional(
          pipe(
            object({
              "do-connecting-ip": fallback(optional(IpAddress), () => undefined),
              "x-forwarded-for": fallback(
                optional(
                  pipe(
                    string(),
                    transform((value) => value.slice(value.lastIndexOf(",") + 1).trim()),
                    IpAddress,
                  ),
                ),
                () => undefined,
              ),
            }),
            transform(({ "do-connecting-ip": ip, "x-forwarded-for": forwarded }) => ({
              ip: ip ?? forwarded,
            })),
          ),
        ),
        validatorHook({ debug }),
      ),
      vValidator(
        "json",
        object({
          redirectURI: optional(string()),
          scope: optional(picklist(["basic", "bridge", "business", "cardLimit", "manteca", "panda-business"])),
        }),
        validatorHook({ debug }),
      ),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const payload = c.req.valid("json");
        const scope = payload.scope ?? "basic";
        const redirectURI = payload.redirectURI;
        const credential = await database.query.credentials.findFirst({
          columns: { id: true, account: true, pandaId: true, salt: true },
          where: eq(credentials.id, credentialId),
        });
        if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
        const account = parse(Address, credential.account);
        setUser({ id: account });
        setContext("exa", { credential });

        if (scope === "panda-business") {
          const ip = c.req.valid("header")?.ip;
          if (!ip) {
            return c.json({ code: BadRequestCodes.BAD_REQUEST, message: ["missing valid client IP address"] }, 400);
          }
          try {
            let application = await panda.getCompanyApplication(credentialId);
            if (!application) {
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
                case "completed":
                case "needs_review":
                  throw new BusinessApplicationError("business inquiry is not complete", "processing");
                case "approved":
                  break;
              }
              const personaAccount = await persona.getAccount(credentialId, "business");
              if (!personaAccount) throw new BusinessApplicationError("business account not started", "not started");
              if (personaAccount.attributes["reference-id"] !== credentialId)
                throw new BusinessApplicationError("business account is not complete", "processing");
              const profile = { ...personaAccount.attributes.fields };
              for (const [name, value] of Object.entries(inquiry.attributes.fields ?? {})) {
                const field = name.replaceAll("-", "_");
                if (
                  is(nullish(pipe(string(), trim(), maxLength(0))), profile[field]) &&
                  !is(nullish(pipe(string(), trim(), maxLength(0))), value)
                )
                  profile[field] = value;
              }
              const result = safeParse(BusinessFields, profile);
              if (!result.success) {
                setContext("validation", { flatten: flatten(result.issues) });
                if (
                  result.issues.every(
                    (issue) =>
                      (issue.kind === "schema" && (issue.received === "null" || issue.input === undefined)) ||
                      (issue.kind === "validation" && issue.received === "0"),
                  )
                )
                  throw new BusinessApplicationError("business account is not complete", "processing");
                throw new BusinessApplicationError("invalid business Persona fields", "bad request");
              }
              const fields = result.output;
              const owners = [
                ...new Set(
                  Object.keys(profile)
                    .filter((key) => key.startsWith("ubo_"))
                    .map((key) => Number(/_(\d+)$/.exec(key)?.[1] ?? 1)),
                ),
              ]
                .toSorted((a, b) => a - b)
                .flatMap((index) => {
                  const address = index + 2;
                  const block = {
                    birth_date: profile[index === 1 ? "ubo_birth_date" : `ubo_birth_date_${index}`],
                    city: profile[`city_${address}`],
                    country_code: profile[`country_code_${address}`],
                    country_id: profile[`ubo_country_id_${index}`],
                    email: profile[`ubo_email_${index}`],
                    id: profile[`ubo_id_${index}`],
                    last_name: profile[`ubo_last_name_${index}`],
                    name: profile[`ubo_name_${index}`],
                    postal_code: profile[`postal_code_${address}`],
                    street_1: profile[`street_1_${address}`],
                    street_2: profile[`street_2_${index + 1}`],
                    subdivision: profile[`subdivision_${address}`],
                  };
                  if (Object.values(block).every((value) => is(nullish(pipe(string(), trim(), maxLength(0))), value)))
                    return [];
                  const parsed = safeParse(UboFields, block);
                  if (!parsed.success) {
                    setContext("validation", { flatten: flatten(parsed.issues) });
                    if (
                      parsed.issues.every(
                        (issue) =>
                          (issue.kind === "schema" && (issue.received === "null" || issue.input === undefined)) ||
                          (issue.kind === "validation" && issue.received === "0"),
                      )
                    )
                      throw new BusinessApplicationError("business account is not complete", "processing");
                    throw new BusinessApplicationError("invalid business Persona fields", "bad request");
                  }
                  const ubo = parsed.output;
                  return [
                    {
                      address: {
                        line1: ubo.street_1,
                        line2: ubo.street_2,
                        city: ubo.city,
                        region: ubo.subdivision,
                        postalCode: ubo.postal_code,
                        countryCode: ubo.country_code,
                      },
                      birthDate: ubo.birth_date,
                      countryOfIssue: ubo.country_id,
                      email: ubo.email,
                      firstName: ubo.name,
                      lastName: ubo.last_name,
                      nationalId: ubo.id,
                    },
                  ];
                });
              const [owner] = owners;
              if (!owner) throw new BusinessApplicationError("business account is not complete", "processing");
              application = await panda.createCompanyApplication(credentialId, {
                name: fields.business_name,
                address: {
                  line1: fields.street_1_2,
                  line2: fields.street_2,
                  city: fields.city_2,
                  region: fields.subdivision_2,
                  postalCode: fields.postal_code_2,
                  countryCode: fields.country_code_2,
                },
                entity: {
                  name: fields.business_name,
                  description: fields.company_description,
                  industry: fields.company_industry_naics,
                  registrationNumber: fields.company_registration_number,
                  taxId: fields.company_tax_id,
                  website: fields.company_website,
                },
                initialUser: { ...owner, ipAddress: ip, walletAddress: account },
                representatives: [owner],
                ultimateBeneficialOwners: owners,
              });
            }
            const status = application.applicationStatus;
            let code = "processing";
            if (status === "approved") code = "ok";
            else if (status === "denied" || status === "locked" || status === "canceled") code = "bad kyb";
            if (code === "ok") {
              for (const template of businessSteps) {
                const inquiry = await persona.getInquiry(credentialId, template);
                if (!inquiry) {
                  const { data } = await persona.createInquiry(credentialId, template, redirectURI);
                  return c.json(await generateInquiryTokens(data.id, persona), 200);
                }
                switch (inquiry.attributes.status) {
                  case "created":
                  case "pending":
                  case "expired":
                    return c.json(await generateInquiryTokens(inquiry.id, persona), 200);
                  case "completed":
                  case "needs_review":
                    return c.json({ code: "processing" }, 400);
                  case "failed":
                  case "declined":
                    return c.json({ code: "bad kyc" }, 400);
                  case "approved":
                    break;
                  default:
                    throw new Error("unknown inquiry status");
                }
              }
            }
            return c.json(
              {
                code,
                completionLink: application.applicationCompletionLink ?? undefined,
                type: "panda" as const,
                verificationLink: application.applicationExternalVerificationLink ?? undefined,
              },
              code === "bad kyb" ? 400 : 200,
            );
          } catch (error: unknown) {
            if (error instanceof BusinessApplicationError)
              return c.json({ code: error.code, message: [error.message] }, 400);
            if (error instanceof ServiceError && error.status === 400)
              return c.json({ code: BadRequestCodes.BAD_REQUEST, message: [error.message] }, 400);
            throw error;
          }
        }

        if (scope === "cardLimit") {
          const cardLimit = await persona.getCardLimitStatus(credentialId);
          switch (cardLimit.status) {
            case "resolved":
              return c.json({ code: "already approved" }, 400);
            case "approved":
              captureException(new Error("inquiry approved but account not updated"), {
                level: "error",
                contexts: { inquiry: { templateId: CARD_LIMIT_TEMPLATE, referenceId: credentialId } },
              });
              return c.json({ code: "already approved" }, 400);
            case "noTemplate":
              return c.json({ code: "not started" }, 400);
            case "noInquiry": {
              const basicAccount = await persona.getAccount(credentialId, "basic").catch((error: unknown) => {
                captureException(error, {
                  level: "error",
                  contexts: { details: { credentialId, scope: "cardLimit" } },
                });
              });
              const { data } = await persona.createInquiry(
                credentialId,
                CARD_LIMIT_TEMPLATE,
                redirectURI,
                basicAccount
                  ? {
                      "name-first": basicAccount.attributes["name-first"],
                      "name-last": basicAccount.attributes["name-last"],
                    }
                  : undefined,
              );
              return c.json(await generateInquiryTokens(data.id, persona), 200);
            }
            case "completed":
            case "needs_review":
              return c.json({ code: "processing" }, 400);
            case "pending":
            case "created":
            case "expired":
              return c.json(await generateInquiryTokens(cardLimit.id, persona), 200);
            case "failed":
            case "declined":
              return c.json({ code: "failed" }, 400);
            default:
              throw new Error("unknown inquiry status");
          }
        }

        let inquiryTemplateId: Awaited<ReturnType<(typeof persona)["getPendingInquiryTemplate"]>>;
        try {
          inquiryTemplateId = await persona.getPendingInquiryTemplate(credentialId, scope);
        } catch (error: unknown) {
          if (error instanceof Error && error.message === scopeValidationErrors.NOT_SUPPORTED) {
            return c.json({ code: "not supported" }, 400);
          }
          throw error;
        }
        if (!inquiryTemplateId) {
          return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
        }

        const inquiry = await persona.getInquiry(credentialId, inquiryTemplateId);
        if (!inquiry) {
          const { data } = await persona.createInquiry(credentialId, inquiryTemplateId, redirectURI);
          return c.json(await generateInquiryTokens(data.id, persona), 200);
        }

        switch (inquiry.attributes.status) {
          case "approved":
            captureException(new Error("inquiry approved but account not updated"), {
              level: "error",
              contexts: { inquiry: { templateId: inquiryTemplateId, referenceId: credentialId } },
            });
            return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
          case "failed":
          case "declined":
            return c.json({ code: "failed", legacy: "kyc failed" }, 400);
          case "completed":
          case "needs_review":
            return c.json({ code: "processing", legacy: "kyc failed" }, 400);
          case "pending":
          case "created":
          case "expired":
            return c.json(await generateInquiryTokens(inquiry.id, persona), 200);
          default:
            throw new Error("unknown inquiry status");
        }
      },
    )
    .post(
      "/application",
      auth,
      honoOpenapi.describeRoute({
        summary: "Submit KYC application",
        description: `
Submit information for KYC application.

**Encrypted kyc payload**

When the payload includes the \`ciphertext\` field (alongside \`key\`, \`iv\`, \`tag\`), it is treated as encrypted. Encryption is auto-detected from the payload shape.

The steps to encrypt are:

1. Generate AES Key: Create a random 256-bit AES key
2. Encrypt Payload: Use AES-256-GCM to encrypt your KYC JSON data
3. Encrypt AES Key: Use Rain-provided RSA public key with OAEP padding
4. Encode Components: Base64-encode all encrypted components
5. Submit Request

KYC Encryption Public Key for sandbox is:

\`\`\`
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyZixoAuo015iMt+JND0y
usAvU2iJhtKRM+7uAxd8iXq7Z/3kXlGmoOJAiSNfpLnBAG0SCWslNCBzxf9+2p5t
HGbQUkZGkfrYvpAzmXKsoCrhWkk1HKk9f7hMHsyRlOmXbFmIgQHggEzEArjhkoXD
pl2iMP1ykCY0YAS+ni747DqcDOuFqLrNA138AxLNZdFsySHbxn8fzcfd3X0J/m/T
2dZuy6ChfDZhGZxSJMjJcintFyXKv7RkwrYdtXuqD3IQYakY3u6R1vfcKVZl0yGY
S2kN/NOykbyVL4lgtUzf0IfkwpCHWOrrpQA4yKk3kQRAenP7rOZThdiNNzz4U2BE
2wIDAQAB
-----END PUBLIC KEY-----
\`\`\`

KYC Encryption Public Key for production needs to be provided.

A working and tested [example is available in here](../../../organization-authentication/#how-to-create-the-encrypted-kyc-payload-with-siwe-statement)

**Payload structure before encryption**

1. Personal information (name, date of birth, address)
2. Identity verification documents
3. Compliance information (occupation, income, etc.)
4. Terms of service acceptance

Here's the markdown table with object notation for nested fields:

| fieldName | type | example | notes |
|-----------|------|---------|-------|
| email | string | user@domain.com | |
| lastName | string | Doe | |
| firstName | string | John | |
| nationalId | string | 123456789 | |
| birthDate | string | 1970-01-01 | |
| countryOfIssue | string | US | |
| phoneCountryCode | string | 1 | |
| phoneNumber | string | 5551234567 | |
| address.line1 | string | 123 Main Street | |
| address.line2 | string | Apt 4B | |
| address.city | string | New York | |
| address.region | string | NY | |
| address.postalCode | string | 10001 | |
| address.countryCode | string | US | |
| ipAddress | string | 192.168.1.100 | |
| occupation | string | 11-1011 | Ask for the mandatory occupation codes |
| annualSalary | string | 75000 | |
| accountPurpose | string | Personal Banking | |
| expectedMonthlyVolume | string | 5000 | |
| isTermsOfServiceAccepted | boolean | true | |

**Authentication and organization verification**

The exa account needs to be authenticated but also a member of the organization that submit the KYC application needs to probe that
belong to the organization and needs to have *kyc* permission, every owner and admin of an organization has this permission.

To probe the member of the organization needs to generate a SIWE message with the following statement and viem library is recommended:

"I apply for KYC approval on behalf of address [checksum address] with payload hash [hash]";

The hash is sha256(encryptedPayload.ciphertext)

The siwe message will be:

| fieldName | type | example | notes |
|-----------|------|---------|-------|
| verify.message | string | SIWE message that includes the statement | |
| verify.signature | Hex | signature of the message | |
| verify.walletAddress | Address | address of the member of the organization that signed the message | |
| verify.chainId | number | 11155420 | |

A working and tested [example is available in here](../../../organization-authentication/#how-to-create-the-encrypted-kyc-payload-with-siwe-statement)

Note that the member of the organization must be created, the organization must exist and the member must be added as admin by another admin or owner.

Working example about how to login is [here](../../../organization-authentication/#siwe-authentication)

The admin should add a member using [addMember method](https://www.better-auth.com/docs/plugins/organization#add-member).
`,
        tags: ["KYC"],
        responses: {
          200: {
            description: "KYC application submitted successfully",
            content: {
              "application/json": {
                schema: resolver(object({ status: string() }), { errorMode: "ignore" }),
              },
            },
          },
          400: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(
                  union([
                    object({ code: picklist(["invalid encryption", "no account", "bad chain"]), message: string() }),
                    object({
                      ...buildBaseResponse(BadRequestCodes.BAD_REQUEST).entries,
                      message: optional(array(string())),
                    }),
                  ]),
                  {
                    errorMode: "ignore",
                  },
                ),
              },
            },
          },
          401: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(
                  union([
                    object({
                      code: literal("invalid payload"),
                      message: string(),
                    }),
                    object({
                      code: string(),
                    }),
                  ]),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
          409: {
            description: "Conflict",
            content: {
              "application/json": {
                schema: resolver(object({ code: literal(BadRequestCodes.ALREADY_STARTED) }), { errorMode: "ignore" }),
              },
            },
          },
          403: {
            description: "Forbidden",
            content: {
              "application/json": {
                schema: resolver(
                  object({
                    code: picklist(["no permission", "no organization"]),
                    message: optional(string()),
                  }),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
        },
        validateResponse: true,
      }),
      vValidator(
        "json",
        union([
          object({
            ...Application.entries,
            verify: object({ message: string(), signature: Hex, walletAddress: Address, chainId: number() }),
          }),
          object({
            key: string(),
            iv: string(),
            ciphertext: string(),
            tag: string(),
            verify: object({ message: string(), signature: Hex, walletAddress: Address, chainId: number() }),
          }),
        ]),
        validatorHook({ debug }),
      ),
      async (c) => {
        const payload = c.req.valid("json");
        const { message, signature, walletAddress: address } = payload.verify;

        if (!(await verifyMessage({ address, message, signature }))) {
          return c.json({ code: "no permission", message: "invalid signature" }, 403);
        }
        const account = await database.query.walletAddresses.findFirst({
          where: eq(walletAddresses.address, address),
          with: {
            user: {
              columns: { id: true },
              with: {
                members: {
                  columns: { role: true },
                  with: { organization: { columns: { id: true, role: true } } },
                },
              },
            },
          },
        });

        if (!account) return c.json({ code: "no account", message: `no account found for address ${address}` }, 400);
        const member = account.user.members[0];
        if (!member) return c.json({ code: "no organization" }, 403);
        if (member.role !== "admin" && member.role !== "owner") return c.json({ code: "no permission" }, 403);
        if (member.organization.role !== "kyc") return c.json({ code: "no permission" }, 403);

        const { credentialId } = c.req.valid("cookie");
        const credential = await database.query.credentials.findFirst({
          columns: { id: true, account: true, pandaId: true },
          where: eq(credentials.id, credentialId),
        });
        if (!credential) return c.json({ code: "no credential" }, 500);
        setUser({ id: parse(Address, credential.account) });
        setContext("exa", { credential });

        const siweMessage = parseSiweMessage(payload.verify.message);

        if (siweMessage.domain !== new URL(origin(c.req.raw)).host)
          return c.json({ code: "no permission", message: "invalid domain" }, 403);

        if (siweMessage.chainId !== chain.id)
          return c.json({ code: "bad chain", message: `expected ${chain.id} but got ${siweMessage.chainId}` }, 400);

        const { verify, ...body } = payload;
        const hash =
          "ciphertext" in body
            ? sha256(Buffer.from(body.ciphertext, "base64"))
            : await canonicalize.then((serialize) => {
                const canon = serialize(body);
                if (!canon) throw new Error("bad body");
                return sha256(Buffer.from(canon, "utf8"));
              });

        const expected = `I apply for KYC approval on behalf of address ${parse(Address, credential.account)} with payload hash ${hash}`;
        if (siweMessage.statement !== expected) {
          return c.json(
            {
              code: "no permission",
              message: `invalid statement, expected: [${expected}] but got [${siweMessage.statement}]`,
            },
            403,
          );
        }

        if (credential.pandaId) return c.json({ code: BadRequestCodes.ALREADY_STARTED }, 409);

        try {
          const application = await panda.submitApplication(body);
          await database
            .update(credentials)
            .set({ pandaId: application.id, source: member.organization.id })
            .where(eq(credentials.id, credentialId));
          return c.json({ status: application.applicationStatus }, 200);
        } catch (error) {
          if (error instanceof ServiceError) {
            switch (error.status) {
              case 400:
                return c.json({ code: "invalid encryption", message: error.message }, 400);
              case 401:
                return c.json({ code: "invalid payload", message: error.message }, 401);
            }
          }
          throw error;
        }
      },
    )
    .patch(
      "/application",
      auth,
      honoOpenapi.describeRoute({
        summary: "Update KYC application",
        description: "Update the KYC application",
        tags: ["KYC"],
        responses: {
          200: {
            description: "KYC application updated successfully",
            content: {
              "application/json": {
                schema: resolver(buildBaseResponse("ok"), { errorMode: "ignore" }),
              },
            },
          },
          400: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(
                  union([
                    buildBaseResponse(BadRequestCodes.NOT_STARTED),
                    object({
                      ...buildBaseResponse(BadRequestCodes.BAD_REQUEST).entries,
                      legacy: optional(pipe(string(), metadata({ examples: [BadRequestCodes.BAD_REQUEST] }))),
                      message: optional(array(string())),
                    }),
                  ]),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
        },
        validateResponse: true,
      }),
      vValidator("json", ApplicationUpdate, validatorHook({ debug })),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const payload = c.req.valid("json");
        const credential = await database.query.credentials.findFirst({
          columns: { id: true, account: true, pandaId: true },
          where: eq(credentials.id, credentialId),
        });
        if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
        setUser({ id: parse(Address, credential.account) });
        setContext("exa", { credential });
        if (!credential.pandaId) {
          return c.json({ code: BadRequestCodes.NOT_STARTED, legacy: BadRequestCodes.NOT_STARTED }, 400);
        }
        try {
          await panda.updateApplication(credential.pandaId, payload);
        } catch (error) {
          if (error instanceof ServiceError && error.status === 400) {
            return c.json({ code: BadRequestCodes.BAD_REQUEST, message: [error.message] }, 400);
          }
          throw error;
        }
        return c.json({ code: "ok", legacy: "ok" }, 200);
      },
    )
    .get(
      "/application",
      auth,
      honoOpenapi.describeRoute({
        summary: "Get KYC application status",
        description: "Get the status of the KYC application",
        tags: ["KYC"],
        responses: {
          200: {
            description: "KYC application status",
            content: {
              "application/json": {
                schema: resolver(KYCStatusResponse, { errorMode: "ignore" }),
              },
            },
          },
          400: {
            description: "Bad request",
            content: {
              "application/json": {
                schema: resolver(
                  union([
                    buildBaseResponse(BadRequestCodes.NOT_STARTED),
                    object({
                      ...buildBaseResponse(BadRequestCodes.BAD_REQUEST).entries,
                      message: optional(array(string())),
                    }),
                  ]),
                  { errorMode: "ignore" },
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const { credentialId } = c.req.valid("cookie");
        const credential = await database.query.credentials.findFirst({
          columns: { id: true, account: true, pandaId: true },
          where: eq(credentials.id, credentialId),
        });
        if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
        setUser({ id: parse(Address, credential.account) });
        setContext("exa", { credential });
        if (!credential.pandaId) {
          return c.json({ code: BadRequestCodes.NOT_STARTED, legacy: BadRequestCodes.NOT_STARTED }, 400);
        }
        const status = await panda.getApplicationStatus(credential.pandaId);
        return c.json(
          { code: "ok", legacy: "ok", status: status.applicationStatus, reason: status.applicationReason ?? "unknown" },
          200,
        );
      },
    );
}

async function isLegacy(
  credentialId: string,
  account: Address,
  factory: string,
  publicKey: Uint8Array<ArrayBuffer>,
  salt: string,
  persona: ReturnType<typeof createPersona>,
): Promise<boolean> {
  if (factory === exaAccountFactoryAddress) return false;
  return await startSpan({ name: "exa.kyc", op: "isLegacy" }, async () => {
    const installedPlugin = await publicClient.readContract({
      address: account,
      functionName: "getInstalledPlugins",
      abi: upgradeableModularAccountAbi,
      factory: parse(Address, factory),
      factoryData: accountInit({ ...decodePublicKey(publicKey), salt }),
    });
    if (installedPlugin.length === 0) return false;
    if (installedPlugin.includes(exaPluginAddress)) return false;
    const [legacyKYC, inquiry] = await Promise.all([
      persona.getInquiry(credentialId, CRYPTOMATE_TEMPLATE),
      persona.getInquiry(credentialId, PANDA_TEMPLATE),
    ]);

    return legacyKYC?.attributes.status === "approved" && !inquiry;
  });
}

async function generateInquiryTokens(inquiryId: string, persona: ReturnType<typeof createPersona>) {
  const { meta: sessionTokenMeta } = await persona.resumeInquiry(inquiryId);
  return { inquiryId, sessionToken: sessionTokenMeta["session-token"], type: "persona" };
}

const BusinessFields = object({
  business_name: pipe(string(), trim(), minLength(1)),
  city_2: pipe(string(), trim(), minLength(1)),
  company_description: pipe(string(), trim(), minLength(1)),
  company_industry_naics: pipe(string(), trim(), minLength(1)),
  company_registration_number: pipe(string(), trim(), minLength(1)),
  company_tax_id: pipe(string(), trim(), minLength(1)),
  company_website: pipe(string(), trim(), minLength(1)),
  country_code_2: pipe(string(), trim(), minLength(1)),
  postal_code_2: pipe(string(), trim(), minLength(1)),
  street_1_2: pipe(string(), trim(), minLength(1)),
  street_2: optional(
    pipe(
      nullable(string()),
      transform((value) => {
        const trimmed = value?.trim();
        return trimmed === "" ? undefined : trimmed;
      }),
    ),
  ),
  subdivision_2: pipe(string(), trim(), minLength(1)),
});

const UboFields = object({
  birth_date: pipe(string(), trim(), minLength(1)),
  city: pipe(string(), trim(), minLength(1)),
  country_code: pipe(string(), trim(), minLength(1)),
  country_id: pipe(string(), trim(), minLength(1)),
  email: pipe(string(), trim(), minLength(1)),
  id: pipe(string(), trim(), minLength(1)),
  last_name: pipe(string(), trim(), minLength(1)),
  name: pipe(string(), trim(), minLength(1)),
  postal_code: pipe(string(), trim(), minLength(1)),
  street_1: pipe(string(), trim(), minLength(1)),
  street_2: optional(
    pipe(
      nullable(string()),
      transform((value) => {
        const trimmed = value?.trim();
        return trimmed === "" ? undefined : trimmed;
      }),
    ),
  ),
  subdivision: pipe(string(), trim(), minLength(1)),
});
