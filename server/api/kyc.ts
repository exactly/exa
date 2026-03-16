import { captureException, setContext, setUser, startSpan } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as vValidator } from "hono-openapi/valibot";
import { literal, object, optional, parse, picklist, string } from "valibot";
import { getAddress } from "viem";

import accountInit from "@exactly/common/accountInit";
import {
  exaAccountFactoryAddress,
  exaPluginAddress,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import database, { credentials } from "../database/index";
import auth from "../middleware/auth";
import decodePublicKey from "../utils/decodePublicKey";
import {
  CARD_LIMIT_TEMPLATE,
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  getAccount,
  getCardLimitStatus,
  getInquiry,
  getPendingInquiryTemplate,
  getUnknownAccount,
  PANDA_TEMPLATE,
  parseAccount,
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
        countryCode: optional(literal("true")),
        scope: optional(picklist(["basic", "bridge", "cardLimit", "manteca"])),
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

      if (scope === "cardLimit") {
        const unknownAccount = c.req.valid("query").countryCode
          ? await getUnknownAccount(credentialId).catch((error: unknown): undefined => {
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
        const cardLimit = await getCardLimitStatus(credentialId, unknownAccount);

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
    auth(),
    vValidator(
      "json",
      object({
        redirectURI: optional(string()),
        scope: optional(picklist(["basic", "bridge", "cardLimit", "manteca"])),
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

      if (scope === "cardLimit") {
        const cardLimit = await getCardLimitStatus(credentialId);
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
            const basicAccount = await getAccount(credentialId, "basic").catch((error: unknown) => {
              captureException(error, { level: "error", contexts: { details: { credentialId, scope: "cardLimit" } } });
            });
            const { data } = await createInquiry(
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
            return c.json(await generateInquiryTokens(data.id), 200);
          }
          case "completed":
          case "needs_review":
            return c.json({ code: "processing" }, 400);
          case "pending":
          case "created":
          case "expired":
            return c.json(await generateInquiryTokens(cardLimit.id), 200);
          case "failed":
          case "declined":
            return c.json({ code: "failed" }, 400);
          default:
            throw new Error("unknown inquiry status");
        }
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
        return c.json({ code: "already approved", legacy: "kyc already approved" }, 400);
      }

      const inquiry = await getInquiry(credentialId, inquiryTemplateId);
      if (!inquiry) {
        const { data } = await createInquiry(credentialId, inquiryTemplateId, redirectURI);
        return c.json(await generateInquiryTokens(data.id), 200);
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
          return c.json(await generateInquiryTokens(inquiry.id), 200);
        default:
          throw new Error("unknown inquiry status");
      }
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
