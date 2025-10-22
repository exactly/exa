import { captureException, setContext, setUser, startSpan } from "@sentry/node";
import canonicalize from "canonicalize";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import * as honoOpenapi from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { array, literal, metadata, object, optional, parse, picklist, pipe, string, union } from "valibot";
import { getAddress, sha256 } from "viem";
import { parseSiweMessage } from "viem/siwe";

import accountInit from "@exactly/common/accountInit";
import {
  exaAccountFactoryAddress,
  exaPluginAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database/index";
import auth from "../middleware/auth";
import betterAuth from "../utils/auth";
import decodePublicKey from "../utils/decodePublicKey";
import {
  SubmitApplicationRequest as Application,
  UpdateApplicationRequest as ApplicationUpdate,
  getApplicationStatus,
  KycError,
  submitApplication,
  updateApplication,
} from "../utils/panda";
import {
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  getAccount,
  getInquiry,
  getPendingInquiryTemplate,
  PANDA_TEMPLATE,
  resumeInquiry,
  scopeValidationErrors,
} from "../utils/persona";
import publicClient from "../utils/publicClient";
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const KYCStatusResponse = object({
  code: pipe(string(), metadata({ examples: ["ok"] })),
  legacy: pipe(string(), metadata({ examples: ["ok"] })),
  status: pipe(string(), metadata({ examples: ["approved", "rejected"] })),
  reason: pipe(string(), metadata({ examples: ["", "BAD_SELFIE"] })),
});

const BadRequestCodes = {
  ALREADY_STARTED: "already started",
  NOT_STARTED: "not started",
  BAD_REQUEST: "bad request",
} as const;

function buildBaseResponse(example = "string") {
  return object({
    code: pipe(string(), metadata({ examples: [example] })),
    legacy: pipe(string(), metadata({ examples: [example] })),
  });
}

export default new Hono()
  .get(
    "/",
    auth(),
    vValidator(
      "query",
      object({
        countryCode: optional(literal("true")),
        scope: optional(picklist(["basic", "manteca"])),
      }),
      validatorHook(),
    ),
    async (c) => {
      const scope = c.req.valid("query").scope ?? "basic";

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true, factory: true, publicKey: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);

      const account = parse(Address, credential.account);
      setUser({ id: account });
      setContext("exa", { credential });

      if (scope === "basic" && credential.pandaId) {
        if (c.req.valid("query").countryCode) {
          const personaAccount = await getAccount(credentialId, scope).catch((error: unknown) => {
            captureException(error, { level: "error", contexts: { details: { credentialId, scope } } });
          });
          const countryCode = personaAccount?.attributes["country-code"];
          countryCode && c.header("User-Country", countryCode);
        }
        return c.json({ code: "ok", legacy: "ok" }, 200);
      }

      if (await isLegacy(credentialId, account, credential.factory, credential.publicKey)) {
        return c.json({ code: "legacy kyc", legacy: "legacy kyc" }, 200);
      }

      let inquiryTemplateId: Awaited<ReturnType<typeof getPendingInquiryTemplate>>;
      try {
        inquiryTemplateId = await getPendingInquiryTemplate(credentialId, scope);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === scopeValidationErrors.NOT_SUPPORTED) {
          return c.json({ code: "not supported" }, 400);
        }
        throw error;
      }
      if (!inquiryTemplateId) {
        if (c.req.valid("query").countryCode) {
          const personaAccount = await getAccount(credentialId, scope).catch((error: unknown) => {
            captureException(error, { level: "error", contexts: { details: { credentialId, scope } } });
          });
          const countryCode = personaAccount?.attributes["country-code"];
          countryCode && c.header("User-Country", countryCode);
        }
        return c.json({ code: "ok", legacy: "ok" }, 200);
      }
      const inquiry = await getInquiry(credentialId, inquiryTemplateId);
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
          return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 400); // TODO send a different response for this transitory statuses
        case "failed":
        case "declined":
          return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 400);
        default:
          throw new Error("Unknown inquiry status");
      }
    },
  )
  .post(
    "/",
    auth(),
    vValidator(
      "json",
      object({
        redirectURI: optional(string()),
        scope: optional(picklist(["basic", "manteca"])),
      }),
      validatorHook({ debug }),
    ),
    async (c) => {
      const { credentialId } = c.req.valid("cookie");
      const payload = c.req.valid("json");
      const scope = payload.scope ?? "basic";
      const redirectURI = payload.redirectURI;
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      setUser({ id: parse(Address, credential.account) });
      setContext("exa", { credential });

      let inquiryTemplateId: Awaited<ReturnType<typeof getPendingInquiryTemplate>>;
      try {
        inquiryTemplateId = await getPendingInquiryTemplate(credentialId, scope);
      } catch (error: unknown) {
        if (error instanceof Error && error.message === scopeValidationErrors.NOT_SUPPORTED) {
          return c.json({ code: "not supported" }, 400);
        }
        throw error;
      }
      if (!inquiryTemplateId) {
        return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
      }

      const inquiry = await getInquiry(credentialId, inquiryTemplateId);
      if (!inquiry) {
        const { data } = await createInquiry(credentialId, inquiryTemplateId, redirectURI);
        const { inquiryId, sessionToken } = await generateInquiryTokens(data.id);
        return c.json({ inquiryId, sessionToken }, 200);
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
          return c.json({ code: "failed", legacy: "kyc failed" }, 400); // TODO send a different response
        case "pending":
        case "created":
        case "expired": {
          const { inquiryId, sessionToken } = await generateInquiryTokens(inquiry.id);
          return c.json({ inquiryId, sessionToken }, 200);
        }
        default:
          throw new Error("Unknown inquiry status");
      }
    },
  )
  .post(
    "/application",
    auth(),
    honoOpenapi.describeRoute({
      summary: "Submit KYC application",
      description: `
Submit information for KYC application.

**Encrypted kyc payload**

When the header has encrypted=true, the payload should be encrypted.

The steps to encrypt are:

1. Generate AES Key: Create a random 256-bit AES key
2. Encrypt Payload: Use AES-256-GCM to encrypt your KYC JSON data
3. Encrypt AES Key: Use Rain-provided RSA public key with OAEP padding
4. Encode Components: Base64-encode all encrypted components
5. Set Header: Include encrypted: "true" header in your request
6. Submit Request

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

"I apply for KYC approval on behalf of [lowercase exa account address]"

The siwe message will be:

| fieldName | type | example | notes |
|-----------|------|---------|-------|
| verify.message | string | SIWE message that includes the statement | |
| verify.signature | string | signature of the message | |
| verify.walletAddress | string | address of the member of the organization that signed the message | |
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
                  object({ code: literal("invalid encryption"), message: string() }),
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
    vValidator("json", Application, validatorHook({ debug })),
    vValidator("header", optional(object({ encrypted: optional(string()) })), validatorHook({ debug })),
    async (c) => {
      const payload = c.req.valid("json");
      const verifyResponse = await betterAuth.api.verifySiweMessage({
        body: payload.verify,
        request: c.req.raw,
        asResponse: true,
      });
      if (!verifyResponse.ok) {
        const errorBody = parse(object({ code: string(), message: string() }), await verifyResponse.json());
        return c.json({ code: "no permission", message: errorBody.message }, 403);
      }
      const headers = new Headers();
      headers.set("cookie", verifyResponse.headers.get("set-cookie") ?? "");
      const organizations = await betterAuth.api.listOrganizations({ headers });
      const source = organizations[0]?.id;
      if (!source) return c.json({ code: "no organization" }, 403);

      const { success: canCreate } = await betterAuth.api.hasPermission({
        headers,
        body: {
          organizationId: source,
          permissions: {
            kyc: ["create"],
          },
        },
      });
      if (!canCreate) return c.json({ code: "no permission" }, 403);

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential" }, 500);
      setUser({ id: parse(Address, credential.account) });
      setContext("exa", { credential });

      const siweMessage = parseSiweMessage(payload.verify.message);
      const { verify, ...body } = payload;
      const hash =
        "ciphertext" in body
          ? sha256(Buffer.from(body.ciphertext, "base64"))
          : sha256(Buffer.from(JSON.stringify(canonicalize(body)), "utf8"));
      if (
        siweMessage.statement !==
        `I apply for KYC approval on behalf of address ${parse(Address, credential.account)} with payload hash ${hash}`
      ) {
        return c.json({ code: "no permission", message: "invalid statement" }, 403);
      }

      if (credential.pandaId) {
        return c.json({ code: BadRequestCodes.ALREADY_STARTED }, 409);
      }
      try {
        const application = await submitApplication(payload, c.req.header("encrypted") === "true");
        await database
          .update(credentials)
          .set({ pandaId: application.id, source })
          .where(eq(credentials.id, credentialId));
        return c.json({ status: application.applicationStatus }, 200);
      } catch (error) {
        if (error instanceof KycError) {
          switch (error.statusCode) {
            case 400:
              return c.json({ code: "invalid encryption", message: error.message }, 400);
            case 401:
              return c.json({ code: "invalid payload", message: error.message }, 401);
            default:
              return c.json({ code: error.message }, 401);
          }
        }
        throw error;
      }
    },
  )
  .patch(
    "/application",
    auth(),
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
      await updateApplication(credential.pandaId, payload);
      return c.json({ code: "ok", legacy: "ok" }, 200);
    },
  )
  .get(
    "/application",
    auth(),
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
      const status = await getApplicationStatus(credential.pandaId);
      return c.json(
        { code: "ok", legacy: "ok", status: status.applicationStatus, reason: status.applicationReason ?? "unknown" },
        200,
      );
    },
  );

async function isLegacy(
  credentialId: string,
  account: Address,
  factory: string,
  publicKey: Uint8Array<ArrayBuffer>,
): Promise<boolean> {
  if (factory === exaAccountFactoryAddress) return false;
  return await startSpan({ name: "exa.kyc", op: "isLegacy" }, async () => {
    const installedPlugin = await publicClient.readContract({
      address: account,
      functionName: "getInstalledPlugins",
      abi: upgradeableModularAccountAbi,
      factory: getAddress(factory),
      factoryData: accountInit(decodePublicKey(publicKey)),
    });
    if (installedPlugin.length === 0) return false;
    if (installedPlugin.includes(exaPluginAddress)) return false;
    const [legacyKYC, inquiry] = await Promise.all([
      getInquiry(credentialId, CRYPTOMATE_TEMPLATE),
      getInquiry(credentialId, PANDA_TEMPLATE),
    ]);

    return legacyKYC?.attributes.status === "approved" && !inquiry;
  });
}

async function generateInquiryTokens(inquiryId: string): Promise<{ inquiryId: string; sessionToken: string }> {
  const { meta: sessionTokenMeta } = await resumeInquiry(inquiryId);
  return { inquiryId, sessionToken: sessionTokenMeta["session-token"] };
}
