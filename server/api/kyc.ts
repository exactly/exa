import { Address } from "@exactly/common/validation";
import { setContext, setUser } from "@sentry/node";
import createDebug from "debug";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as vValidator } from "hono-openapi/valibot";
import { object, parse, optional, string, pipe, metadata, union, array, partial, check } from "valibot";

import database, { credentials } from "../database/index";
import auth from "../middleware/auth";
import {
  SubmitApplicationRequest as Application,
  UpdateApplicationRequest as ApplicationUpdate,
  getApplicationStatus,
  submitApplication,
  updateApplication,
} from "../utils/kyc";
import {
  createInquiry,
  CRYPTOMATE_TEMPLATE,
  generateOTL,
  getAccount,
  getInquiry,
  PANDA_TEMPLATE,
  resumeInquiry,
  updateAccountFields,
} from "../utils/persona";
import { MantecaOnboarding } from "../utils/ramps/manteca";
import validatorHook from "../utils/validatorHook";

const debug = createDebug("exa:kyc");
Object.assign(debug, { inspectOpts: { depth: undefined } });

const KYCUpdateRequest = pipe(
  partial(
    object({
      ...MantecaOnboarding.entries,
    }),
  ),
  check((input) => Object.keys(input).length > 0, "at least one field is required"),
);
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
      const { data } = await createInquiry(credentialId, redirectURI);
      const { meta } = await generateOTL(data.id);
      return c.json({ otl: meta["one-time-link"], legacy: meta["one-time-link"] }, 200);
    },
  )
  .patch("/", auth(), vValidator("json", KYCUpdateRequest, validatorHook({ debug })), async (c) => {
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
    const inquiry = await getInquiry(credentialId, templateId);
    if (!inquiry) return c.json({ code: "no kyc", legacy: "kyc not found" }, 404);
    if (inquiry.attributes.status !== "approved") {
      return c.json({ code: "bad kyc", legacy: "kyc not approved" }, 400);
    }
    const accountId = inquiry.relationships.account?.data?.id;
    if (!accountId) throw new Error("no account id");

    const updates = c.req.valid("json");
    await updateAccountFields(accountId, updates);
    return c.json({ code: "ok", legacy: "ok" }, 200);
  })
  .post(
    "/application",
    auth(),
    describeRoute({
      summary: "Submit KYC application",
      description: "Submit information for KYC application",
      tags: ["KYC"],
      responses: {
        200: {
          description: "KYC application submitted successfully",
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
                  buildBaseResponse(BadRequestCodes.ALREADY_STARTED),
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
    vValidator("json", Application, validatorHook({ debug })),
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

      if (credential.pandaId) {
        return c.json({ code: BadRequestCodes.ALREADY_STARTED, legacy: BadRequestCodes.ALREADY_STARTED }, 400);
      }

      const application = await submitApplication(payload);
      await database.update(credentials).set({ pandaId: application.id }).where(eq(credentials.id, credentialId));
      return c.json({ code: "ok", legacy: "ok" }, 200);
    },
  )
  .patch(
    "/application",
    auth(),
    describeRoute({
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
    describeRoute({
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
