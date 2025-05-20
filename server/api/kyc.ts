import { Address } from "@exactly/common/validation";
import { captureException, setContext, setUser } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { description, flatten, object, optional, parse, pipe, string, title } from "valibot";

import database, { credentials } from "../database/index";
import auth from "../middleware/auth";
import {
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  generateOTL,
  getAccount,
  getInquiry,
  PANDA_TEMPLATE,
  resumeInquiry,
} from "../utils/persona";

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default new Hono()
  .get(
    "/",
    describeRoute({
      summary: "Get KYC status",
      description:
        "Retrieves the current KYC status for the user. It can also be used to resume a pending or expired KYC inquiry.",
      responses: {
        200: {
          description: "KYC status or session token to resume an inquiry.",
          content: {
            "application/json": { schema: resolver(object({}), { errorMode: "ignore" }) },
          },
        },
        400: { description: "Bad request (e.g., invalid template, KYC not started, or KYC not approved)." },
        404: { description: "KYC inquiry not found." },
        500: { description: "Internal server error (e.g., no credential found)." },
      },
      validateResponse: true,
    }),
    auth(),
    async (c) => {
      const templateId = c.req.query("templateId") ?? CRYPTOMATE_TEMPLATE;
      if (templateId !== CRYPTOMATE_TEMPLATE && templateId !== PANDA_TEMPLATE) {
        return c.json({ code: "bad template", legacy: "invalid persona template" }, 400);
      }
      const { credentialId } = c.req.valid("cookie");
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
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
    },
  )
  .post(
    "/",
    describeRoute({
      summary: "Initiate or resume KYC",
      description:
        "Initiates a new KYC inquiry if one doesn't exist or is in a final state (e.g., approved, failed). If an inquiry exists and is pending or expired, it generates a one-time link (OTL) to resume it.",
      responses: {
        200: {
          description: "One-time link (OTL) to start or resume the KYC process.",
          content: {
            "application/json": { schema: resolver(object({}), { errorMode: "ignore" }) },
          },
        },
        400: { description: "Bad request (e.g., KYC already approved, KYC failed)." },
        500: { description: "Internal server error (e.g., no credential found)." },
      },
      validateResponse: true,
    }),
    auth(),
    vValidator(
      "json",
      object({
        templateId: optional(
          pipe(
            string(),
            title("Persona Template ID"),
            description("Optional ID for the Persona template to be used for KYC."),
          ),
        ),
      }),
      (validation, c) => {
        if (debug.enabled) {
          c.req
            .text()
            .then(debug)
            .catch((error: unknown) => captureException(error));
        }
        if (!validation.success) {
          captureException(new Error("bad kyc"), {
            contexts: { validation: { ...validation, flatten: flatten(validation.issues) } },
          });
          return c.json({ code: "bad request", legacy: "bad request" }, 400);
        }
      },
    ),
    async (c) => {
      const payload = c.req.valid("json");
      const { credentialId } = c.req.valid("cookie");
      const templateId = payload.templateId ?? CRYPTOMATE_TEMPLATE;
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json({ code: "no credential", legacy: "no credential" }, 500);
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
      const { data } = await createInquiry(credentialId);
      const { meta } = await generateOTL(data.id);
      return c.json({ otl: meta["one-time-link"], legacy: meta["one-time-link"] }, 200);
    },
  );
