import { captureException, setContext, setUser, startSpan } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as vValidator } from "hono-openapi/valibot";
import { literal, object, optional, parse, picklist, string } from "valibot";

import {
  exaAccountFactoryAddress,
  exaPluginAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database/index";
import auth from "../middleware/auth";
import {
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  generateOTL,
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

export default new Hono()
  .get(
    "/",
    auth(),
    vValidator(
      "query",
      object({
        templateId: optional(picklist([CRYPTOMATE_TEMPLATE, PANDA_TEMPLATE])), // TODO remove this after deprecate templateId query parameter
        countryCode: optional(literal("true")),
        scope: optional(picklist(["basic", "manteca"])),
      }),
      validatorHook(),
    ),
    async (c) => {
      const templateId = c.req.valid("query").templateId;
      const scope = c.req.valid("query").scope ?? "basic";

      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true, pandaId: true, factory: true },
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

      if (templateId) {
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
        const personaAccount = await getAccount(credentialId, "basic").catch((error: unknown) => {
          captureException(error, { level: "warning", contexts: { details: { credentialId, scope } } });
        });
        const countryCode = personaAccount?.attributes["country-code"];
        countryCode && c.header("User-Country", countryCode);
        return c.json({ code: "ok", legacy: "ok" }, 200);
      }

      if (await isLegacy(credentialId, account, credential.factory)) {
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
        templateId: optional(string()), // TODO remove this after deprecate templateId query parameter
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
        // TODO use a query param to select otl or sessionToken
        const { inquiryId, otl, sessionToken, legacy } = await generateInquiryTokens(data.id);
        return c.json({ inquiryId, otl, sessionToken, legacy }, 200);
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
          // TODO use a query param to select otl or sessionToken
          const { inquiryId, otl, sessionToken, legacy } = await generateInquiryTokens(inquiry.id);
          return c.json({ inquiryId, otl, sessionToken, legacy }, 200);
        }
        default:
          throw new Error("Unknown inquiry status");
      }
    },
  );

async function isLegacy(credentialId: string, account: Address, factory: string): Promise<boolean> {
  if (factory === exaAccountFactoryAddress) return false;
  return await startSpan({ name: "exa.kyc", op: "isLegacy" }, async () => {
    const installedPlugin = await publicClient.readContract({
      address: account,
      functionName: "getInstalledPlugins",
      abi: upgradeableModularAccountAbi,
    });
    if (installedPlugin.length === 0) return false;
    if (installedPlugin.includes(exaPluginAddress)) return false;
    const [legacyKyc, inquiry] = await Promise.all([
      getInquiry(credentialId, CRYPTOMATE_TEMPLATE),
      getInquiry(credentialId, PANDA_TEMPLATE),
    ]);

    return legacyKyc?.attributes.status === "approved" && !inquiry;
  });
}

async function generateInquiryTokens(inquiryId: string): Promise<{
  inquiryId: string;
  legacy: string;
  otl: string;
  sessionToken: string;
}> {
  const [{ meta: otlMeta }, { meta: sessionTokenMeta }] = await Promise.all([
    generateOTL(inquiryId),
    resumeInquiry(inquiryId),
  ]);
  return {
    inquiryId,
    legacy: otlMeta["one-time-link"],
    otl: otlMeta["one-time-link"],
    sessionToken: sessionTokenMeta["session-token"],
  };
}
