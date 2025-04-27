import { Address } from "@exactly/common/validation";
import { vValidator } from "@hono/valibot-validator";
import { captureException, setContext, setUser } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
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

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

export default new Hono()
  .get("/", auth(), async (c) => {
    const templateId = c.req.query("templateId") ?? CRYPTOMATE_TEMPLATE;
    if (templateId !== CRYPTOMATE_TEMPLATE && templateId !== PANDA_TEMPLATE) {
      return c.json("invalid persona template", 400);
    }
    const { credentialId } = c.req.valid("cookie");
    const credential = await database.query.credentials.findFirst({
      columns: { id: true, account: true },
      where: eq(credentials.id, credentialId),
    });
    if (!credential) return c.json("credential not found", 404);
    setUser({ id: parse(Address, credential.account) });
    setContext("exa", { credential });
    const inquiry = await getInquiry(credentialId, templateId);
    if (!inquiry) return c.json("kyc not found", 404);
    if (inquiry.attributes.status === "created") return c.json("kyc not started", 400);
    if (inquiry.attributes.status === "pending" || inquiry.attributes.status === "expired") {
      const { meta } = await resumeInquiry(inquiry.id);
      const result = { inquiryId: inquiry.id, sessionToken: meta["session-token"] };
      return c.json(result, 200);
    }
    if (inquiry.attributes.status !== "approved") return c.json("kyc not approved", 400);
    const account = await getAccount(credentialId);
    if (account) c.header("User-Country", account.attributes["country-code"]);
    return c.json("ok", 200);
  })
  .post(
    "/",
    auth(),
    vValidator("json", object({ templateId: optional(string()) }), (validation, c) => {
      if (debug.enabled) {
        c.req
          .text()
          .then(debug)
          .catch((error: unknown) => captureException(error));
      }
      if (!validation.success) {
        captureException(new Error("bad kyc"), { contexts: { validation } });
        return c.json("bad request", 400);
      }
    }),
    async (c) => {
      const payload = c.req.valid("json");
      const { credentialId } = c.req.valid("cookie");
      const templateId = payload.templateId ?? CRYPTOMATE_TEMPLATE;
      const credential = await database.query.credentials.findFirst({
        columns: { id: true, account: true },
        where: eq(credentials.id, credentialId),
      });
      if (!credential) return c.json("credential not found", 404);
      setUser({ id: parse(Address, credential.account) });
      setContext("exa", { credential });
      const inquiry = await getInquiry(credentialId, templateId);
      if (inquiry) {
        if (inquiry.attributes.status === "approved") return c.json("kyc already approved", 400);
        if (inquiry.attributes.status === "created" || inquiry.attributes.status === "expired") {
          const { meta } = await generateOTL(inquiry.id);
          return c.json(meta["one-time-link"]);
        }
        return c.json("kyc failed", 400);
      }
      const { data } = await createInquiry(credentialId);
      const { meta } = await generateOTL(data.id);
      return c.json(meta["one-time-link"]);
    },
  );
