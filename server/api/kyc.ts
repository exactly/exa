import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";
import { setContext, setUser } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { object, parse, optional, string, pipe, metadata, union, array, literal, picklist } from "valibot";
import { sha256, verifyMessage } from "viem";
import { parseSiweMessage } from "viem/siwe";

import database, { credentials, walletAddresses } from "../database/index";
import auth from "../middleware/auth";
import {
  SubmitApplicationRequest as Application,
  UpdateApplicationRequest as ApplicationUpdate,
  getApplicationStatus,
  submitApplication,
  updateApplication,
  KycError,
} from "../utils/kyc";
import {
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  generateOTL,
  getAccount,
  getInquiry,
  PANDA_TEMPLATE,
  resumeInquiry,
} from "../utils/persona";
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

export default new Hono()
  .get("/", auth(), async (c) => {
    const templateId = c.req.query("templateId") ?? CRYPTOMATE_TEMPLATE;
    if (templateId !== CRYPTOMATE_TEMPLATE && templateId !== PANDA_TEMPLATE) {
      return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
    }
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      columns: { id: true, account: true, pandaId: true },
      where: eq(credentials.id, credentialId),
    });
    if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
    if (credential.pandaId) return c.json({ code: "ok", legacy: "ok" }, 200);
    setUser({ id: parse(Address, credential.account) });
    setContext("exa", { credential });
    const inquiry = await getInquiry(credentialId, templateId);
    if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc not found" }, 404);
    if (inquiry.attributes.status === "created") {
      return c.json({ code: "not started", legacy: "kyc not started" }, 400);
    }
    if (inquiry.attributes.status === "pending" || inquiry.attributes.status === "expired") {
      const { meta } = await resumeInquiry(inquiry.id);
      return c.json({ inquiryId: inquiry.id, sessionToken: meta["session-token"] }, 200);
    }
    if (inquiry.attributes.status !== "approved") {
      return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 400);
    }
    const account = await getAccount(credentialId);
    if (account) c.header("User-Country", account.attributes["country-code"]);
    return c.json({ code: "ok", legacy: "ok" }, 200);
  })
  .post(
    "/",
    auth(),
    vValidator(
      "json",
      object({ templateId: optional(string()), redirectURI: optional(string()) }),
      validatorHook({ debug }),
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const { credentialId } = c.req.valid("cookie");
      const templateId = payload.templateId ?? CRYPTOMATE_TEMPLATE;
      const redirectURI = payload.redirectURI;
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
      if (credential.pandaId) return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
      setUser({ id: parse(Address, credential.account) });
      setContext("exa", { credential });
      const inquiry = await getInquiry(credentialId, templateId);
      if (inquiry) {
        if (inquiry.attributes.status === "approved") {
          return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
        }
        if (inquiry.attributes.status === "created" || inquiry.attributes.status === "expired") {
          const { meta } = await generateOTL(inquiry.id);
          return c.json({ otl: meta["one-time-link"], legacy: meta["one-time-link"] }, 200);
        }
        return c.json({ code: "failed", legacy: "kyc failed" }, 400);
      }
      const { data } = await createInquiry(credentialId, redirectURI);
      const { meta } = await generateOTL(data.id);
      return c.json({ otl: meta["one-time-link"], legacy: meta["one-time-link"] }, 200);
    },
  )
  .post(
    "/application",
    auth(),
    describeRoute({
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
      security: [{ cookieAuth: [] }],
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
          description: "Invalid Payload",
          content: {
            "application/json": {
              schema: resolver(
                object({
                  code: literal("invalid payload"),
                  message: optional(string()),
                }),
                { errorMode: "ignore" },
              ),
            },
          },
        },
        409: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: resolver(
                union([
                  object({ code: literal(BadRequestCodes.ALREADY_STARTED) }),
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
      const { message, signature, walletAddress: address } = payload.verify;

      if (!(await verifyMessage({ address, message, signature }))) {
        return c.json({ code: "no permission", message: "invalid signature" }, 403);
      }

      const account = await database.query.walletAddresses.findFirst({
        where: eq(walletAddresses.address, address),
        with: {
          user: { columns: { id: true }, with: { members: { columns: { organizationId: true, role: true } } } },
        },
      });

      if (!account) return c.json({ code: "no account", message: `no account found for address ${address}` }, 400);
      const member = account.user.members[0];
      if (!member) return c.json({ code: "no organization" }, 403);
      if (member.role !== "admin" && member.role !== "owner") return c.json({ code: "no permission" }, 403);

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential" }, 500);
      setUser({ id: parse(Address, credential.account) });
      setContext("exa", { credential });

      const siweMessage = parseSiweMessage(payload.verify.message);

      if (siweMessage.chainId !== chain.id)
        return c.json({ code: "bad chain", message: `expected ${chain.id} but got ${siweMessage.chainId}` }, 400);

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

      if (credential.pandaId) return c.json({ code: BadRequestCodes.ALREADY_STARTED }, 409);

      try {
        const application = await submitApplication(payload, c.req.header("encrypted") === "true");
        await database
          .update(credentials)
          .set({ pandaId: application.id, source: member.organizationId })
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
    describeRoute({
      summary: "Update KYC application",
      description: "Update the KYC application",
      tags: ["KYC"],
      security: [{ cookieAuth: [] }],
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
    describeRoute({
      summary: "Get KYC application status",
      description: "Get the status of the KYC application",
      tags: ["KYC"],
      security: [{ cookieAuth: [] }],
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
        { code: "ok", legacy: "ok", status: status.applicationStatus, reason: status.applicationReason },
        200,
      );
    },
  );

function buildBaseResponse(example = "string") {
  return object({
    code: pipe(string(), metadata({ examples: [example] })),
    legacy: pipe(string(), metadata({ examples: [example] })),
  });
}

function canonicalize(json: unknown) {
  if (json === null || typeof json !== "object") return json;
  if (Array.isArray(json)) return null;
  const sortedKeys = Object.keys(json).sort();
  const result: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    result[key] = canonicalize((json as Record<string, unknown>)[key]);
  }
  return result;
}
