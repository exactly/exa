import { Address } from "@exactly/common/validation";
import { setContext, setUser } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { validator as vValidator } from "hono-openapi/valibot";
import { object, optional, parse, string } from "valibot";

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
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

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
  );
