import "../mocks/auth";
import "../mocks/panda";
import "../mocks/persona";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import canonicalize from "canonicalize";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import crypto from "node:crypto";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { getAddress, padHex, sha256 } from "viem";
import { mnemonicToAccount } from "viem/accounts";
import { createSiweMessage, generateSiweNonce } from "viem/siwe";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import domain from "@exactly/common/domain";
import chain, { exaAccountFactoryAddress, exaPluginAddress } from "@exactly/common/generated/chain";
import { business } from "@exactly/common/tenants";
import { Address } from "@exactly/common/validation";

import route from "../../api/kyc";
import database, { credentials, organizations, sources } from "../../database";
import authenticate from "../../middleware/auth";
import createAuth from "../../utils/auth";
import authSecret from "../../utils/authSecret";
import createPanda, * as Panda from "../../utils/panda";
import createPersona, * as Persona from "../../utils/persona";
import { scopeValidationErrors } from "../../utils/persona";
import publicClient from "../../utils/publicClient";
import ServiceError from "../../utils/ServiceError";

import type * as v from "valibot";

const auth = createAuth(database, authSecret);
const panda = Object.assign(
  createPanda({
    key: parse(pipe(string(), nonEmpty()), env.PANDA_API_KEY),
    url: parse(pipe(string(), nonEmpty()), env.PANDA_API_URL),
  }),
  Panda,
);
const persona = Object.assign(
  createPersona(
    parse(pipe(string(), nonEmpty()), env.PERSONA_API_KEY),
    parse(pipe(string(), nonEmpty()), env.PERSONA_URL),
  ),
  Persona,
);
const app = route({
  auth: authenticate(""),
  database,
  panda,
  persona,
});
const appClient = testClient(app);

vi.mock("@sentry/node", { spy: true });

describe("authenticated", () => {
  beforeEach(async () => {
    await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
  });

  afterEach(() => vi.restoreAllMocks());

  describe("basic scope", () => {
    describe("getting kyc", () => {
      it("is the default scope", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": "bob" } });

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      });

      it("returns ok kyc approved with country code when panda id is present", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
        const getInquiry = vi.spyOn(persona, "getInquiry");
        const getAccount = vi
          .spyOn(persona, "getAccount")
          .mockResolvedValueOnce(basicAccount as Persona.AccountOutput<"basic">);

        const response = await appClient.index.$get(
          { query: { countryCode: "true", scope: "basic" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        expect(getAccount).toHaveBeenCalledOnce();
        expect(getInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.headers.get("User-Country")).toBe("AR");
        expect(response.status).toBe(200);
      });

      it("returns ok code when account has all fields", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
      });

      it("returns not started when inquiry is not found", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns ok and sends sentry error if template is required but inquiry is approved", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: "bob" } },
        });
      });

      it("returns not started when inquiry is created", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "created" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns not started when inquiry is pending", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns not started when inquiry is expired", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "expired" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns processing when inquiry is completed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "completed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });

      it("returns processing when inquiry needs review", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "needs_review" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry failed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });
    });

    describe("posting kyc", () => {
      it("is the default scope", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await appClient.index.$post(
          { json: {} },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      });

      it("returns already approved when account has all fields", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
      });

      it("returns already approved and sends sentry error when template is required but inquiry is approved", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: "bob" } },
        });
      });

      it("returns session token when creating inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(createInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when resuming created inquiry", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "created" },
        });
        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when resuming pending inquiry", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });
        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when resuming expired inquiry", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "expired" },
        });
        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns failed kyc when inquiry failed", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns failed kyc when inquiry is declined", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "declined" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns processing when inquiry is completed", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "completed" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns processing when inquiry needs review", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "needs_review" },
        });
        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });
    });
  });

  describe("isLegacy flow", () => {
    const legacyFactory = "0x0000000000000000000000000000000000001234";
    const legacyPlugin = "0x0000000000000000000000000000000000005678";

    beforeEach(async () => {
      await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
    });

    afterEach(() => vi.restoreAllMocks());

    it("skips legacy check when factory is current exaAccountFactory", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: exaAccountFactoryAddress })
        .where(eq(credentials.id, "bob"));
      const readContract = vi.spyOn(publicClient, "readContract");
      const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(readContract).not.toHaveBeenCalled();
      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("returns not legacy when no plugins installed", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      const readContract = vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([]);
      const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(readContract).toHaveBeenCalledOnce();
      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("returns not legacy when latest plugin is installed", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      const readContract = vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([exaPluginAddress]);
      const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(readContract).toHaveBeenCalledOnce();
      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("returns legacy kyc when old plugin with approved cryptomate and no panda inquiry", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([legacyPlugin]);
      const getInquiry = vi.spyOn(persona, "getInquiry");
      getInquiry.mockImplementation((_credentialId, templateId) => {
        if (templateId === persona.CRYPTOMATE_TEMPLATE) {
          return Promise.resolve({
            ...personaTemplate,
            attributes: { ...personaTemplate.attributes, status: "approved" },
          });
        }
        return Promise.resolve(undefined); // eslint-disable-line unicorn/no-useless-undefined
      });

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(getInquiry).toHaveBeenCalledWith("bob", persona.CRYPTOMATE_TEMPLATE);
      expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
      await expect(response.json()).resolves.toStrictEqual({ code: "legacy kyc", legacy: "legacy kyc" });
      expect(response.status).toBe(200);
    });

    it("returns not legacy when old plugin with approved cryptomate but panda inquiry exists", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([legacyPlugin]);
      const getInquiry = vi.spyOn(persona, "getInquiry");
      getInquiry.mockImplementation((_credentialId, templateId) => {
        if (templateId === persona.CRYPTOMATE_TEMPLATE) {
          return Promise.resolve({
            ...personaTemplate,
            attributes: { ...personaTemplate.attributes, status: "approved" },
          });
        }
        return Promise.resolve({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });
      });
      const getPendingInquiryTemplate = vi
        .spyOn(persona, "getPendingInquiryTemplate")
        .mockResolvedValueOnce(persona.PANDA_TEMPLATE);

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(getInquiry).toHaveBeenCalledWith("bob", persona.CRYPTOMATE_TEMPLATE);
      expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
      expect(response.status).toBe(400);
    });

    it("returns not legacy when old plugin with non-approved cryptomate inquiry", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([legacyPlugin]);
      const getInquiry = vi.spyOn(persona, "getInquiry");
      getInquiry.mockImplementation((_credentialId, templateId) => {
        if (templateId === persona.CRYPTOMATE_TEMPLATE) {
          return Promise.resolve({
            ...personaTemplate,
            attributes: { ...personaTemplate.attributes, status: "pending" },
          });
        }
        return Promise.resolve(undefined); // eslint-disable-line unicorn/no-useless-undefined
      });
      const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("returns not legacy when old plugin with no cryptomate inquiry", async () => {
      await database
        .update(credentials)
        .set({ pandaId: null, factory: legacyFactory })
        .where(eq(credentials.id, "bob"));
      vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([legacyPlugin]);
      const getInquiry = vi.spyOn(persona, "getInquiry");
      getInquiry.mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
      const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const response = await appClient.index.$get(
        { query: { scope: "basic" } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });
  });

  describe("manteca scope", () => {
    describe("getting kyc", () => {
      it("returns ok when account has all manteca fields", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
      });

      it("returns ok when account has all manteca fields and country code", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mantecaAccount as Persona.AccountOutput<"manteca">);
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "manteca", countryCode: "true" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.headers.get("User-Country")).toBe("AR");
        expect(response.status).toBe(200);
      });

      it("returns not supported when country is not allowed for manteca", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getPendingInquiryTemplate").mockRejectedValueOnce(
          new Error(scopeValidationErrors.NOT_SUPPORTED),
        );

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not supported" });
        expect(response.status).toBe(400);
      });

      it("returns not started when manteca extra fields inquiry is not found", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns not started when manteca with id class inquiry is not found", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns ok and sends sentry error when manteca inquiry is approved but account not updated", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.MANTECA_TEMPLATE_EXTRA_FIELDS, referenceId: "bob" } },
        });
      });

      it("returns not started when manteca inquiry is pending", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when manteca inquiry failed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });
    });

    describe("posting kyc", () => {
      it("returns already approved when account has all manteca fields", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
      });

      it("returns session token when creating manteca extra fields inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const sessionToken = "manteca-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(createInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_EXTRA_FIELDS, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when creating manteca with id class inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const sessionToken = "manteca-id-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(createInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_WITH_ID_CLASS, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when resuming pending manteca inquiry", async () => {
        const sessionToken = "resume-manteca-session-token";

        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns failed when manteca inquiry failed", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns already approved and sends sentry error when manteca inquiry is approved but account not updated", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "manteca" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "manteca");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.MANTECA_TEMPLATE_EXTRA_FIELDS, referenceId: "bob" } },
        });
      });
    });
  });

  describe("bridge scope", () => {
    describe("getting kyc", () => {
      it("returns ok when account has a supported document", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
      });

      it("returns ok with country code header when account has a supported document", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount as Persona.AccountOutput<"bridge">);
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "bridge", countryCode: "true" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.headers.get("User-Country")).toBe("AR");
        expect(response.status).toBe(200);
      });

      it("returns not supported when documents only have unsupported id classes", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        vi.spyOn(persona, "getPendingInquiryTemplate").mockRejectedValueOnce(
          new Error(scopeValidationErrors.NOT_SUPPORTED),
        );

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not supported" });
        expect(response.status).toBe(400);
      });

      it("returns not started when panda inquiry is not required", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns ok and sends sentry error when inquiry is approved but account not updated", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: "bob" } },
        });
      });

      it("returns not started when inquiry is pending", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry failed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });
    });

    describe("posting kyc", () => {
      it("returns already approved when account has a supported document", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
      });

      it("returns not supported when documents only have unsupported id classes", async () => {
        vi.spyOn(persona, "getPendingInquiryTemplate").mockRejectedValueOnce(
          new Error(scopeValidationErrors.NOT_SUPPORTED),
        );

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not supported" });
        expect(response.status).toBe(400);
      });

      it("returns session token when creating panda inquiry for bridge", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const sessionToken = "bridge-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        expect(createInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns session token when resuming pending bridge inquiry", async () => {
        const sessionToken = "resume-bridge-session-token";

        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({
          type: "persona",
          sessionToken,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns failed when bridge inquiry failed", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns already approved and sends sentry error when bridge inquiry is approved but account not updated", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "bridge" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "bridge");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: "bob" } },
        });
      });
    });
  });

  describe("cardLimit scope", () => {
    beforeEach(async () => {
      await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
    });

    describe("getting kyc", () => {
      it("returns ok when persona account has card_limit_usd set", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "resolved" });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(response.status).toBe(200);
      });

      it("returns ok with country code header when persona account has card_limit_usd set", async () => {
        const unknownAccount = { data: [basicAccount] } satisfies Persona.UnknownAccountOutput;
        vi.spyOn(persona, "getUnknownAccount").mockResolvedValueOnce(unknownAccount);
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "resolved" });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit", countryCode: "true" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        expect(persona.getUnknownAccount).toHaveBeenCalledWith("bob");
        expect(persona.getCardLimitStatus).toHaveBeenCalledWith("bob", unknownAccount);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(response.headers.get("User-Country")).toBe("AR");
        expect(response.status).toBe(200);
      });

      it("omits country code header when basic account lookup fails", async () => {
        vi.spyOn(persona, "getUnknownAccount").mockRejectedValueOnce(new Error("network error"));
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "resolved" });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit", countryCode: "true" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        expect(persona.getUnknownAccount).toHaveBeenCalledWith("bob");
        expect(persona.getCardLimitStatus).toHaveBeenCalledWith("bob", undefined);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(response.headers.get("User-Country")).toBeNull();
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "network error" }), {
          level: "error",
          contexts: { details: { credentialId: "bob", scope: "cardLimit" } },
        });
      });

      it("returns basic kyc required when basic kyc is not approved", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noTemplate" });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "no kyc" });
        expect(response.status).toBe(400);
      });

      it("returns not started when no inquiry exists", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noInquiry" });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
        expect(response.status).toBe(400);
      });

      it("returns ok and sends sentry error when inquiry is approved but account not updated", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({
          status: "approved",
          id: personaTemplate.id,
        });
        vi.mocked(captureException).mockClear();

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "ok" });
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledExactlyOnceWith(
          new Error("inquiry approved but account not updated"),
          { level: "error", contexts: { inquiry: { templateId: persona.CARD_LIMIT_TEMPLATE, referenceId: "bob" } } },
        );
      });

      it.each(["created", "expired", "pending"] as const)("returns not started when inquiry is %s", async (status) => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status, id: personaTemplate.id });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
        expect(response.status).toBe(400);
      });

      it.each(["completed", "needs_review"] as const)("returns processing when inquiry is %s", async (status) => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status, id: personaTemplate.id });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "processing" });
        expect(response.status).toBe(400);
      });

      it.each(["declined", "failed"] as const)("returns bad kyc when inquiry is %s", async (status) => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status, id: personaTemplate.id });

        const response = await appClient.index.$get(
          { query: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc" });
        expect(response.status).toBe(400);
      });
    });

    describe("posting kyc", () => {
      it("returns already approved when persona account has card_limit_usd set", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "resolved" });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "already approved" });
        expect(response.status).toBe(400);
      });

      it("returns not started when basic kyc is not approved", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noTemplate" });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
        expect(response.status).toBe(400);
      });

      it("creates a new inquiry when none exists", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noInquiry" });
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
        vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(persona.getAccount).toHaveBeenCalledWith("bob", "basic");
        expect(persona.createInquiry).toHaveBeenCalledWith("bob", persona.CARD_LIMIT_TEMPLATE, undefined, {
          "name-first": "ALEXANDER J",
          "name-last": "SAMPLE",
        });
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken,
          type: "persona",
        });
        expect(response.status).toBe(200);
      });

      it("creates inquiry without name when account is not found", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noInquiry" });
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(persona.getAccount).toHaveBeenCalledWith("bob", "basic");
        expect(persona.createInquiry).toHaveBeenCalledWith("bob", persona.CARD_LIMIT_TEMPLATE, undefined, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken,
          type: "persona",
        });
        expect(response.status).toBe(200);
      });

      it("creates inquiry without name when getAccount fails", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noInquiry" });
        vi.spyOn(persona, "getAccount").mockRejectedValueOnce(new Error("network error"));
        vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(persona.getAccount).toHaveBeenCalledWith("bob", "basic");
        expect(captureException).toHaveBeenCalledWith(expect.objectContaining({ message: "network error" }), {
          level: "error",
          contexts: { details: { credentialId: "bob", scope: "cardLimit" } },
        });
        expect(persona.createInquiry).toHaveBeenCalledWith("bob", persona.CARD_LIMIT_TEMPLATE, undefined, undefined);
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken,
          type: "persona",
        });
        expect(response.status).toBe(200);
      });

      it.each(["created", "expired", "pending"] as const)("resumes a %s inquiry", async (status) => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status, id: personaTemplate.id });
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: personaTemplate.id,
          sessionToken,
          type: "persona",
        });
        expect(response.status).toBe(200);
      });

      it.each(["declined", "failed"] as const)("returns failed for %s inquiry", async (status) => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status, id: personaTemplate.id });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "failed" });
        expect(response.status).toBe(400);
      });

      it("returns already approved for approved inquiry", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({
          status: "approved",
          id: personaTemplate.id,
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "already approved" });
        expect(response.status).toBe(400);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          level: "error",
          contexts: { inquiry: { templateId: persona.CARD_LIMIT_TEMPLATE, referenceId: "bob" } },
        });
      });

      it("returns processing for completed inquiry", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({
          status: "completed",
          id: personaTemplate.id,
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "processing" });
        expect(response.status).toBe(400);
      });

      it("returns processing for needs_review inquiry", async () => {
        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({
          status: "needs_review",
          id: personaTemplate.id,
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "bob" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "processing" });
        expect(response.status).toBe(400);
      });

      it("returns no credential for missing credential", async () => {
        const response = await appClient.index.$post(
          { json: { scope: "cardLimit" } },
          { headers: { "test-credential-id": "unknown" } },
        );

        await expect(response.json()).resolves.toStrictEqual({ code: "no credential", legacy: "no credential" });
        expect(response.status).toBe(500);
      });

      it("passes redirect uri to create inquiry", async () => {
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getCardLimitStatus").mockResolvedValueOnce({ status: "noInquiry" });
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(basicAccount);
        vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
          ...resumeTemplate,
          meta: { ...resumeTemplate.meta, "session-token": sessionToken },
        });

        const response = await appClient.index.$post(
          { json: { scope: "cardLimit", redirectURI: "https://example.com" } },
          { headers: { "test-credential-id": "bob" } },
        );

        expect(persona.getAccount).toHaveBeenCalledWith("bob", "basic");
        expect(persona.createInquiry).toHaveBeenCalledWith("bob", persona.CARD_LIMIT_TEMPLATE, "https://example.com", {
          "name-first": "ALEXANDER J",
          "name-last": "SAMPLE",
        });
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken,
          type: "persona",
        });
        expect(response.status).toBe(200);
      });
    });
  });

  describe("panda-business scope", () => {
    const businessId = "bob-panda-business";
    const businessAccount = parse(Address, padHex("0xb0e", { size: 20 }));
    const legacyFactory = "0x0000000000000000000000000000000000001234";
    const businessFields = {
      business_name: "Account Acme",
      company_description: "Account software",
      company_industry_naics: "541511",
      company_registration_number: "123",
      company_tax_id: "456",
      company_website: "https://example.com",
      company_type: "corporation",
      company_expected_spend: 1000,
      ubo_name_1: "Jane",
      ubo_last_name_1: "Doe",
      ubo_birth_date: "1990-01-01",
      ubo_id_1: "123456789",
      ubo_country_id_1: "US",
      ubo_email_1: "jane@example.com",
      authorized_user_phone_country_code: "1",
      authorized_user_phone_number: "5555555555",
      terms_and_conditions: true,
      street_1_2: "1 Main St",
      city_2: "New York",
      subdivision_2: "NY",
      postal_code_2: "10001",
      country_code_2: "US",
      street_1_3: "1 Main St",
      city_3: "New York",
      subdivision_3: "NY",
      postal_code_3: "10001",
      country_code_3: "US",
    };
    const owner = {
      address: {
        line1: "1 Main St",
        line2: undefined,
        city: "New York",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
      birthDate: "1990-01-01",
      countryOfIssue: "US",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      nationalId: "123456789",
    };
    const company = {
      name: "Account Acme",
      address: owner.address,
      entity: {
        name: "Account Acme",
        description: "Account software",
        industry: "541511",
        registrationNumber: "123",
        taxId: "456",
        website: "https://example.com",
      },
      initialUser: { ...owner, ipAddress: "127.0.0.1", walletAddress: businessAccount },
      representatives: [owner],
      ultimateBeneficialOwners: [owner],
    };
    const pendingApplication = {
      id: "company-1",
      name: "Account Acme",
      address: {
        line1: "1 Main St",
        city: "New York",
        region: "NY",
        postalCode: "10001",
        countryCode: "US",
      },
      applicationStatus: "pending" as const,
    };
    const completionLink = {
      url: "https://cardmemberportal.com/completion",
      params: { signature: "y".repeat(156), userId: "0e3c467c-01e3-4fe8-8778-1c88e02fd000" },
    };
    const verificationLink = {
      url: "https://cardmemberportal.com/kyc",
      params: { signature: "x".repeat(156), userId: "0e3c467c-01e3-4fe8-8778-1c88e02fd000" },
    };

    function getStatus(scope: "business" | "panda-business") {
      return appClient.index.$get(
        { query: { scope } },
        { headers: { "test-credential-id": businessId, SessionID: "fakeSession" } },
      );
    }

    function submit(scope: "business" | "panda-business", header: Record<string, string> = {}) {
      return appClient.index.$post(
        { json: { scope } },
        { headers: { "test-credential-id": businessId, SessionID: "fakeSession", ...header } },
      );
    }

    function mockProfile() {
      mockInquiry();
      mockAccount();
    }

    function mockInquiry({
      fields = {},
      referenceId = businessId,
      status = "approved",
    }: {
      fields?: Record<string, unknown>;
      referenceId?: string;
      status?: v.InferOutput<typeof Persona.Inquiry>["attributes"]["status"];
    } = {}) {
      vi.spyOn(persona, "getInquiry").mockResolvedValue({
        id: "inquiry-id",
        type: "inquiry",
        attributes: { fields, status, "reference-id": referenceId },
      });
    }

    function mockAccount({
      fields = businessFields,
      referenceId = businessId,
    }: { fields?: Record<string, unknown>; referenceId?: string } = {}) {
      vi.spyOn(persona, "getAccount").mockResolvedValue({
        id: "account-id",
        type: "account",
        attributes: { fields, "reference-id": referenceId },
      });
    }

    beforeAll(async () => {
      await database.insert(credentials).values([
        {
          id: businessId,
          publicKey: new Uint8Array(),
          account: businessAccount,
          factory: exaAccountFactoryAddress,
          salt: business,
        },
      ]);
    });

    afterEach(async () => {
      await database
        .update(credentials)
        .set({ factory: exaAccountFactoryAddress })
        .where(eq(credentials.id, businessId));
    });

    afterAll(async () => {
      await database.delete(credentials).where(eq(credentials.id, businessId));
    });

    describe("getting kyc", () => {
      it("returns not started when the company application is missing", async () => {
        const getCompanyApplication = vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await getStatus("panda-business");

        expect(response.status).toBe(400);
        expect(getCompanyApplication).toHaveBeenCalledWith(businessId);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it("returns processing with the external verification link", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "needsVerification",
          applicationReason: "needs verification",
          applicationExternalVerificationLink: verificationLink,
        });
        const getInquiry = vi.spyOn(persona, "getInquiry");

        const response = await getStatus("panda-business");

        expect(response.status).toBe(200);
        expect(getInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          reason: "needs verification",
          status: "needsVerification",
          verificationLink,
        });
      });

      it("returns processing with the completion link", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "needsInformation",
          applicationReason: "needs information",
          applicationCompletionLink: completionLink,
        });
        const getInquiry = vi.spyOn(persona, "getInquiry");

        const response = await getStatus("panda-business");

        expect(response.status).toBe(200);
        expect(getInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          completionLink,
          code: "processing",
          reason: "needs information",
          status: "needsInformation",
        });
      });

      it.each(["manualReview", "notStarted", "pending"] as const)(
        "returns processing when the status is %s",
        async (status) => {
          vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
            id: businessId,
            applicationStatus: status,
            applicationReason: `${status} reason`,
          });
          const getInquiry = vi.spyOn(persona, "getInquiry");

          const response = await getStatus("panda-business");

          expect(response.status).toBe(200);
          expect(getInquiry).not.toHaveBeenCalled();
          await expect(response.json()).resolves.toStrictEqual({
            code: "processing",
            reason: `${status} reason`,
            status,
          });
        },
      );

      it("returns processing with unknown status and reason when the company application has neither", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({ id: businessId });
        const getInquiry = vi.spyOn(persona, "getInquiry");

        const response = await getStatus("panda-business");

        expect(response.status).toBe(200);
        expect(getInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          reason: "unknown",
          status: "unknown",
        });
      });

      it("returns ok when the company application, checkbox and representative inquiries are approved", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(personaTemplate);
        vi.mocked(captureException).mockClear();

        const response = await getStatus("panda-business");

        expect(response.status).toBe(200);
        expect(getInquiry).toHaveBeenCalledTimes(2);
        expect(getInquiry).toHaveBeenNthCalledWith(1, businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        expect(getInquiry).toHaveBeenNthCalledWith(2, businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        expect(captureException).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "ok",
          reason: "",
          status: "approved",
        });
      });

      it("returns not started when the checkbox inquiry is missing", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await getStatus("panda-business");

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenCalledExactlyOnceWith(businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it.each([
        ["created", "not started"],
        ["pending", "not started"],
        ["expired", "not started"],
        ["completed", "processing"],
        ["needs_review", "processing"],
        ["failed", "bad kyc"],
        ["declined", "bad kyc"],
      ] as const)("returns %s checkbox inquiry as %s", async (status, code) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi
          .spyOn(persona, "getInquiry")
          .mockResolvedValue({ ...personaTemplate, attributes: { ...personaTemplate.attributes, status } });
        vi.mocked(captureException).mockClear();

        const response = await getStatus("panda-business");

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenCalledExactlyOnceWith(businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        expect(captureException).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code });
      });

      it("fails when the checkbox inquiry status is unknown", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "unknown" as never },
        });

        const response = await getStatus("panda-business");

        expect(response.status).toBe(500);
      });

      it("returns not started when the representative inquiry is missing", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi
          .spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await getStatus("panda-business");

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenCalledTimes(2);
        expect(getInquiry).toHaveBeenLastCalledWith(businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started" });
      });

      it.each([
        ["created", "not started"],
        ["pending", "not started"],
        ["expired", "not started"],
        ["completed", "processing"],
        ["needs_review", "processing"],
        ["failed", "bad kyc"],
        ["declined", "bad kyc"],
      ] as const)("returns %s representative inquiry as %s", async (status, code) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi
          .spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce({ ...personaTemplate, attributes: { ...personaTemplate.attributes, status } });
        vi.mocked(captureException).mockClear();

        const response = await getStatus("panda-business");

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenCalledTimes(2);
        expect(getInquiry).toHaveBeenLastCalledWith(businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        expect(captureException).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code });
      });

      it("fails when the representative inquiry status is unknown", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce({
            ...personaTemplate,
            attributes: { ...personaTemplate.attributes, status: "unknown" as never },
          });

        const response = await getStatus("panda-business");

        expect(response.status).toBe(500);
      });

      it.each(["denied", "locked", "canceled"] as const)(
        "returns bad kyb when the company application is %s",
        async (status) => {
          vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
            id: businessId,
            applicationStatus: status,
            applicationReason: "not approved",
          });
          const getInquiry = vi.spyOn(persona, "getInquiry");

          const response = await getStatus("panda-business");

          expect(response.status).toBe(400);
          expect(getInquiry).not.toHaveBeenCalled();
          await expect(response.json()).resolves.toStrictEqual({
            code: "bad kyb",
            reason: "not approved",
            status,
          });
        },
      );

      it("skips the legacy check", async () => {
        await database.update(credentials).set({ factory: legacyFactory }).where(eq(credentials.id, businessId));
        const readContract = vi.spyOn(publicClient, "readContract");
        const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate");
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry").mockResolvedValue(personaTemplate);

        const response = await getStatus("panda-business");

        expect(response.status).toBe(200);
        expect(readContract).not.toHaveBeenCalled();
        expect(getPendingInquiryTemplate).not.toHaveBeenCalled();
      });
    });

    describe("posting kyc", () => {
      it("creates the company application for a business credential", async () => {
        mockProfile();
        const getCompanyApplication = vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi
          .spyOn(panda, "createCompanyApplication")
          .mockResolvedValue(pendingApplication);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(getCompanyApplication).toHaveBeenCalledWith(businessId);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, company);
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          type: "panda",
        });
      });

      it.each([
        [{ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }, "203.0.113.7"],
        [{ "x-forwarded-for": "203.0.113.7" }, "203.0.113.7"],
        [{ "do-connecting-ip": "127.0.0.1", "x-forwarded-for": "203.0.113.7" }, "127.0.0.1"],
        [{ "do-connecting-ip": "not-an-ip", "x-forwarded-for": "203.0.113.7" }, "203.0.113.7"],
      ])("reads the client ip from %j", async (header, ip) => {
        mockProfile();
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi
          .spyOn(panda, "createCompanyApplication")
          .mockResolvedValue(pendingApplication);

        const response = await submit("panda-business", header);

        expect(response.status).toBe(200);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, {
          ...company,
          initialUser: { ...owner, ipAddress: ip, walletAddress: businessAccount },
        });
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", type: "panda" });
      });

      it.each<Record<string, string>>([{}, { "x-forwarded-for": "203.0.113.7, not-an-ip" }])(
        "returns bad request without a valid client ip from %j",
        async (header) => {
          mockProfile();
          const getCompanyApplication = vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
          const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

          const response = await submit("panda-business", header);

          expect(response.status).toBe(400);
          expect(getCompanyApplication).not.toHaveBeenCalled();
          expect(createCompanyApplication).not.toHaveBeenCalled();
          expect(persona.getInquiry).not.toHaveBeenCalled();
          await expect(response.json()).resolves.toStrictEqual({
            code: "bad request",
            message: ["missing valid client IP address"],
          });
        },
      );

      it("returns ok when the company application, checkbox and representative inquiries are approved", async () => {
        const getCompanyApplication = vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(personaTemplate);
        const createInquiry = vi.spyOn(persona, "createInquiry");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(getCompanyApplication).toHaveBeenCalledWith(businessId);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        expect(getInquiry).toHaveBeenCalledTimes(2);
        expect(getInquiry).toHaveBeenNthCalledWith(1, businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        expect(getInquiry).toHaveBeenNthCalledWith(2, businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        expect(createInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "ok",
          type: "panda",
        });
      });

      it("creates the checkbox inquiry once the company application is approved", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(getInquiry).toHaveBeenCalledExactlyOnceWith(businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        expect(createInquiry).toHaveBeenCalledExactlyOnceWith(
          businessId,
          persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE,
          undefined, // eslint-disable-line unicorn/no-useless-undefined
        );
        expect(resumeInquiry).toHaveBeenCalledWith(inquiry.data.id);
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: inquiry.data.id,
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });
      });

      it.each(["created", "pending", "expired"] as const)("resumes a %s checkbox inquiry", async (status) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status },
        });
        const createInquiry = vi.spyOn(persona, "createInquiry");
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(createInquiry).not.toHaveBeenCalled();
        expect(resumeInquiry).toHaveBeenCalledWith(personaTemplate.id);
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: personaTemplate.id,
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });
      });

      it.each([
        ["completed", "processing"],
        ["needs_review", "processing"],
        ["failed", "bad kyc"],
        ["declined", "bad kyc"],
      ] as const)("returns a %s checkbox inquiry as %s", async (status, code) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status },
        });
        const createInquiry = vi.spyOn(persona, "createInquiry");
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createInquiry).not.toHaveBeenCalled();
        expect(resumeInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code });
      });

      it("fails when the checkbox inquiry status is unknown", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "unknown" as never },
        });

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(500);
      });

      it("creates the representative inquiry once the checkbox inquiry is approved", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi
          .spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(inquiry);
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(getInquiry).toHaveBeenCalledTimes(2);
        expect(getInquiry).toHaveBeenNthCalledWith(1, businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        expect(getInquiry).toHaveBeenNthCalledWith(2, businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        expect(createInquiry).toHaveBeenCalledExactlyOnceWith(
          businessId,
          persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE,
          undefined, // eslint-disable-line unicorn/no-useless-undefined
        );
        expect(resumeInquiry).toHaveBeenCalledWith(inquiry.data.id);
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: inquiry.data.id,
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });
      });

      it.each(["created", "pending", "expired"] as const)("resumes a %s representative inquiry", async (status) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce({
            ...personaTemplate,
            id: "representative-id",
            attributes: { ...personaTemplate.attributes, status },
          });
        const createInquiry = vi.spyOn(persona, "createInquiry");
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(createInquiry).not.toHaveBeenCalled();
        expect(resumeInquiry).toHaveBeenCalledExactlyOnceWith("representative-id");
        await expect(response.json()).resolves.toStrictEqual({
          inquiryId: "representative-id",
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });
      });

      it.each([
        ["completed", "processing"],
        ["needs_review", "processing"],
        ["failed", "bad kyc"],
        ["declined", "bad kyc"],
      ] as const)("returns a %s representative inquiry as %s", async (status, code) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        const getInquiry = vi
          .spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce({ ...personaTemplate, attributes: { ...personaTemplate.attributes, status } });
        const createInquiry = vi.spyOn(persona, "createInquiry");
        const resumeInquiry = vi.spyOn(persona, "resumeInquiry");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenLastCalledWith(businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        expect(createInquiry).not.toHaveBeenCalled();
        expect(resumeInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code });
      });

      it("fails when the representative inquiry status is unknown", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        vi.spyOn(persona, "getInquiry")
          .mockResolvedValueOnce(personaTemplate)
          .mockResolvedValueOnce({
            ...personaTemplate,
            attributes: { ...personaTemplate.attributes, status: "unknown" as never },
          });

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(500);
      });

      it("returns bad kyb when the existing company application is denied", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue({
          id: businessId,
          applicationStatus: "denied",
          applicationReason: "sanctions",
        });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad kyb",
          type: "panda",
        });
      });

      it("prefers an account field over an inquiry field", async () => {
        mockInquiry({ fields: { "company-description": "Inquiry software" } });
        mockAccount();
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi
          .spyOn(panda, "createCompanyApplication")
          .mockResolvedValue(pendingApplication);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, company);
      });

      it.each([undefined, null, "", "  "])(
        "falls back to the inquiry field when the account field is %j",
        async (value) => {
          mockInquiry({ fields: { "company-description": "Inquiry software" } });
          mockAccount({ fields: { ...businessFields, company_description: value } });
          vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
          const createCompanyApplication = vi
            .spyOn(panda, "createCompanyApplication")
            .mockResolvedValue(pendingApplication);

          const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

          expect(response.status).toBe(200);
          expect(createCompanyApplication).toHaveBeenCalledWith(businessId, {
            ...company,
            entity: { ...company.entity, description: "Inquiry software" },
          });
        },
      );

      it("returns processing when the account and inquiry fields are blank", async () => {
        mockInquiry({ fields: { "company-description": " " } });
        mockAccount({ fields: { ...businessFields, company_description: "" } });
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          message: ["business account is not complete"],
        });
      });

      it("returns processing without ultimate beneficial owners", async () => {
        mockInquiry();
        mockAccount({
          fields: Object.fromEntries(Object.entries(businessFields).filter(([field]) => !field.startsWith("ubo_"))),
        });
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          message: ["business account is not complete"],
        });
      });

      it("returns not started without a business inquiry", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(getInquiry).toHaveBeenCalledWith(businessId, persona.BUSINESS_TEMPLATE);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "not started",
          message: ["business inquiry not started"],
        });
      });

      it("returns bad request when the business inquiry does not match the credential", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry({ referenceId: "other-reference-id" });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad request",
          message: ["business inquiry does not match credential"],
        });
      });

      it.each([
        ["created", "not started", "business inquiry is not started"],
        ["expired", "not started", "business inquiry is not started"],
        ["pending", "not started", "business inquiry is not started"],
        ["failed", "bad kyb", "business inquiry failed"],
        ["declined", "bad kyb", "business inquiry failed"],
        ["completed", "processing", "business inquiry is not complete"],
        ["needs_review", "processing", "business inquiry is not complete"],
      ] as const)("returns a %s business inquiry as %s", async (status, code, message) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry({ status });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code, message: [message] });
      });

      it("returns not started without a business account", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(getAccount).toHaveBeenCalledWith(businessId, "business");
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "not started",
          message: ["business account not started"],
        });
      });

      it("returns processing for a business account without fields", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        vi.spyOn(persona, "getAccount").mockResolvedValue({
          id: "account-id",
          type: "account",
          attributes: { "reference-id": businessId },
        });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          message: ["business account is not complete"],
        });
      });

      it("returns processing when the business account does not match the credential", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        mockAccount({ referenceId: "other-reference-id" });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          message: ["business account is not complete"],
        });
      });

      it.each([["business_name"], ["ubo_email_1"]] as const)("returns processing without %s", async (name) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        mockAccount({ fields: { ...businessFields, [name]: "" } });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "processing",
          message: ["business account is not complete"],
        });
      });

      it("returns bad request for a business field with the wrong type", async () => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        mockAccount({ fields: { ...businessFields, business_name: 123 } });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad request",
          message: ["invalid business Persona fields"],
        });
      });

      it.each([
        ["a padded business name", { ...businessFields, business_name: " Account Acme " }, company],
        ["a null line2", { ...businessFields, street_2: null }, company],
        ["an empty line2", { ...businessFields, street_2: "" }, company],
        ["a blank line2", { ...businessFields, street_2: "   " }, company],
        [
          "a line2",
          { ...businessFields, street_2: "Suite 2" },
          { ...company, address: { ...company.address, line2: "Suite 2" } },
        ],
        ["blank ultimate beneficial owners", { ...businessFields, ubo_birth_date_2: "", ubo_name_2: "  " }, company],
      ])("creates the company application from %s", async (_, fields, expected) => {
        mockInquiry();
        mockAccount({ fields });
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi
          .spyOn(panda, "createCompanyApplication")
          .mockResolvedValue(pendingApplication);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, expected);
      });

      it("maps the ultimate beneficial owners", async () => {
        const owners = [
          {
            address: {
              line1: "2 Second St",
              line2: "Suite 3",
              city: "Boston",
              region: "MA",
              postalCode: "02108",
              countryCode: "US",
            },
            birthDate: "1980-02-02",
            countryOfIssue: "US",
            email: "john@example.com",
            firstName: "John",
            lastName: "Roe",
            nationalId: "987654321",
          },
          {
            address: {
              line1: "3 Third St",
              line2: "Suite 4",
              city: "Toronto",
              region: "ON",
              postalCode: "M5H 2N2",
              countryCode: "CA",
            },
            birthDate: "1985-03-03",
            countryOfIssue: "CA",
            email: "jill@example.com",
            firstName: "Jill",
            lastName: "Poe",
            nationalId: "111222333",
          },
          {
            address: {
              line1: "4 Fourth St",
              line2: "Suite 5",
              city: "Chicago",
              region: "IL",
              postalCode: "60601",
              countryCode: "US",
            },
            birthDate: "1990-04-04",
            countryOfIssue: "US",
            email: "june@example.com",
            firstName: "June",
            lastName: "Doe",
            nationalId: "222333444",
          },
        ];
        mockInquiry();
        mockAccount({
          fields: {
            ...businessFields,
            ubo_name_1: "John",
            ubo_last_name_1: "Roe",
            ubo_birth_date: "1980-02-02",
            ubo_country_id_1: "US",
            ubo_email_1: "john@example.com",
            ubo_id_1: "987654321",
            street_1_3: "2 Second St",
            street_2_2: "Suite 3",
            city_3: "Boston",
            subdivision_3: "MA",
            postal_code_3: "02108",
            country_code_3: "US",
            ubo_name_3: "Jill",
            ubo_last_name_3: "Poe",
            ubo_birth_date_3: "1985-03-03",
            ubo_country_id_3: "CA",
            ubo_email_3: "jill@example.com",
            ubo_id_3: "111222333",
            street_1_5: "3 Third St",
            street_2_4: "Suite 4",
            city_5: "Toronto",
            subdivision_5: "ON",
            postal_code_5: "M5H 2N2",
            country_code_5: "CA",
            ubo_name_4: "June",
            ubo_last_name_4: "Doe",
            ubo_birth_date_4: "1990-04-04",
            ubo_country_id_4: "US",
            ubo_email_4: "june@example.com",
            ubo_id_4: "222333444",
            street_1_6: "4 Fourth St",
            street_2_5: "Suite 5",
            city_6: "Chicago",
            subdivision_6: "IL",
            postal_code_6: "60601",
            country_code_6: "US",
          },
        });
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const createCompanyApplication = vi
          .spyOn(panda, "createCompanyApplication")
          .mockResolvedValue(pendingApplication);

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(200);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, {
          ...company,
          initialUser: { ...owners[0], ipAddress: "127.0.0.1", walletAddress: businessAccount },
          representatives: [owners[0]],
          ultimateBeneficialOwners: owners,
        });
      });

      it.each([
        ["a malformed line2", { ...businessFields, street_2: 123 }, "bad request", "invalid business Persona fields"],
        [
          "a missing business name",
          Object.fromEntries(Object.entries(businessFields).filter(([field]) => field !== "business_name")),
          "processing",
          "business account is not complete",
        ],
        [
          "a missing company description",
          Object.fromEntries(Object.entries(businessFields).filter(([field]) => field !== "company_description")),
          "processing",
          "business account is not complete",
        ],
        [
          "a partially filled ultimate beneficial owner",
          { ...businessFields, ubo_name_2: "John" },
          "processing",
          "business account is not complete",
        ],
        [
          "an ultimate beneficial owner with the wrong type",
          { ...businessFields, ubo_name_1: 123 },
          "bad request",
          "invalid business Persona fields",
        ],
      ])("rejects %s", async (_, fields, code, message) => {
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        mockInquiry();
        mockAccount({ fields });
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication");

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        expect(createCompanyApplication).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code, message: [message] });
      });

      it("returns bad request when panda rejects the company application", async () => {
        mockProfile();
        vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(panda, "createCompanyApplication").mockRejectedValueOnce(
          new ServiceError("Panda", 400, '{"message":"invalid company"}', undefined, "invalid company"),
        );

        const response = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad request",
          message: ["invalid company"],
        });
      });
    });

    describe("state walk", () => {
      it("walks from the business inquiry to the approved company application", async () => {
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValue(persona.BUSINESS_TEMPLATE);
        vi.spyOn(persona, "resumeInquiry").mockResolvedValue(resumeTemplate);
        const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValue(inquiry);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const businessNotStarted = await getStatus("business");
        expect(businessNotStarted.status).toBe(400);
        await expect(businessNotStarted.json()).resolves.toStrictEqual({
          code: "not started",
          legacy: "kyc not started",
        });

        const tokens = await submit("business");
        expect(tokens.status).toBe(200);
        expect(createInquiry).toHaveBeenCalledWith(businessId, persona.BUSINESS_TEMPLATE, undefined);
        await expect(tokens.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });

        getInquiry.mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "completed" },
        });
        const businessCompleted = await getStatus("business");
        expect(businessCompleted.status).toBe(400);
        await expect(businessCompleted.json()).resolves.toStrictEqual({
          code: "processing",
          legacy: "kyc not approved",
        });

        getPendingInquiryTemplate.mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        getInquiry.mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });
        const businessApproved = await getStatus("business");
        expect(businessApproved.status).toBe(200);
        await expect(businessApproved.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });

        const getCompanyApplication = vi.spyOn(panda, "getCompanyApplication").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const pandaNotStarted = await getStatus("panda-business");
        expect(pandaNotStarted.status).toBe(400);
        await expect(pandaNotStarted.json()).resolves.toStrictEqual({ code: "not started" });

        mockProfile();
        const createCompanyApplication = vi.spyOn(panda, "createCompanyApplication").mockResolvedValue({
          ...pendingApplication,
          applicationStatus: "needsVerification",
          applicationReason: "needs verification",
          applicationExternalVerificationLink: verificationLink,
        });
        const pandaSubmitted = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });
        expect(pandaSubmitted.status).toBe(200);
        expect(createCompanyApplication).toHaveBeenCalledWith(businessId, company);
        await expect(pandaSubmitted.json()).resolves.toStrictEqual({
          code: "processing",
          verificationLink,
          type: "panda",
        });

        getCompanyApplication.mockResolvedValue({
          id: businessId,
          applicationStatus: "needsVerification",
          applicationReason: "needs verification",
          applicationExternalVerificationLink: verificationLink,
        });
        const pandaProcessing = await getStatus("panda-business");
        expect(pandaProcessing.status).toBe(200);
        await expect(pandaProcessing.json()).resolves.toStrictEqual({
          code: "processing",
          reason: "needs verification",
          status: "needsVerification",
          verificationLink,
        });

        getCompanyApplication.mockResolvedValue({
          id: businessId,
          applicationStatus: "approved",
          applicationReason: "",
        });
        getInquiry.mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const checkboxNotStarted = await getStatus("panda-business");
        expect(checkboxNotStarted.status).toBe(400);
        expect(getInquiry).toHaveBeenLastCalledWith(businessId, persona.PANDA_BUSINESS_CHECKBOX_TEMPLATE);
        await expect(checkboxNotStarted.json()).resolves.toStrictEqual({ code: "not started" });

        getInquiry.mockResolvedValueOnce(personaTemplate).mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const representativeNotStarted = await getStatus("panda-business");
        expect(representativeNotStarted.status).toBe(400);
        expect(getInquiry).toHaveBeenLastCalledWith(businessId, persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE);
        await expect(representativeNotStarted.json()).resolves.toStrictEqual({ code: "not started" });

        getInquiry.mockResolvedValueOnce(personaTemplate).mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const representativeTokens = await submit("panda-business", { "do-connecting-ip": "127.0.0.1" });
        expect(representativeTokens.status).toBe(200);
        expect(createInquiry).toHaveBeenLastCalledWith(
          businessId,
          persona.BUSINESS_PANDA_REPRESENTATIVE_TEMPLATE,
          undefined, // eslint-disable-line unicorn/no-useless-undefined
        );
        await expect(representativeTokens.json()).resolves.toStrictEqual({
          inquiryId: resumeTemplate.data.id,
          sessionToken: resumeTemplate.meta["session-token"],
          type: "persona",
        });

        getInquiry.mockResolvedValue({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });
        const pandaApproved = await getStatus("panda-business");
        expect(pandaApproved.status).toBe(200);
        await expect(pandaApproved.json()).resolves.toStrictEqual({
          code: "ok",
          reason: "",
          status: "approved",
        });
      });
    });
  });

  describe("application", () => {
    describe("with organization", () => {
      const owner = mnemonicToAccount("test test test test test test test test test test test kyc");
      const ownerHeaders: Headers = new Headers();
      const outsider = mnemonicToAccount("test test test test test test test test test test test bob");
      const outsiderHeaders: Headers = new Headers();
      const account = "bob";

      const applicationPayload = {
        email: "test@example.com",
        lastName: "Doe",
        firstName: "John",
        nationalId: "12345678",
        birthDate: "1990-01-01",
        countryOfIssue: "US",
        phoneCountryCode: "1",
        phoneNumber: "5551234567",
        address: {
          line1: "123 Main St",
          city: "New York",
          region: "NY",
          country: "US",
          postalCode: "10001",
          countryCode: "US",
        },
        ipAddress: "127.0.0.1",
        occupation: "Engineer",
        annualSalary: "100000",
        accountPurpose: "Personal",
        expectedMonthlyVolume: "5000",
        isTermsOfServiceAccepted: true as const,
      };

      let organizationId: string;

      beforeAll(async () => {
        const adminNonceResult = await auth.api.getSiweNonce({
          body: { walletAddress: owner.address, chainId: chain.id },
        });

        const statement = "I accept Exa terms and conditions";
        const ownerMessage = createSiweMessage({
          statement,
          resources: ["https://exactly.github.io/exa"],
          nonce: adminNonceResult.nonce,
          uri: `https://${domain}`,
          address: owner.address,
          chainId: chain.id,
          scheme: "https",
          version: "1",
          domain,
        });

        const ownerLogin = await auth.api.verifySiweMessage({
          body: {
            message: ownerMessage,
            signature: await owner.signMessage({ message: ownerMessage }),
            walletAddress: owner.address,
            chainId: chain.id,
          },
          request: new Request(`https://${domain}`),
          asResponse: true,
        });
        ownerHeaders.set("cookie", ownerLogin.headers.get("set-cookie") ?? "");

        const externalOrganization = await auth.api.createOrganization({
          headers: ownerHeaders,
          body: {
            name: "Organization",
            slug: "organization",
            keepCurrentActiveOrganization: false,
          },
        });
        organizationId = externalOrganization.id;
        await database.update(organizations).set({ role: "kyc" }).where(eq(organizations.id, organizationId));

        const outsiderNonceResult = await auth.api.getSiweNonce({
          body: { walletAddress: outsider.address, chainId: chain.id },
        });
        const message = createSiweMessage({
          statement,
          resources: ["https://exactly.github.io/exa"],
          nonce: outsiderNonceResult.nonce,
          uri: `https://${domain}`,
          address: outsider.address,
          chainId: chain.id,
          scheme: "https",
          version: "1",
          domain,
        });
        const signature = await outsider.signMessage({ message });
        const response = await auth.api.verifySiweMessage({
          body: { message, signature, walletAddress: outsider.address, chainId: chain.id },
          request: new Request(`https://${domain}`),
          asResponse: true,
        });
        outsiderHeaders.set("cookie", response.headers.get("set-cookie") ?? "");
      });

      describe("status", () => {
        it("returns status", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          const getApplicationStatus = vi.spyOn(panda, "getApplicationStatus").mockResolvedValueOnce({
            id: "pandaId",
            applicationStatus: "approved",
            applicationReason: "",
          });
          const response = await appClient.application.$get(
            { query: {} },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          await expect(response.json()).resolves.toStrictEqual({
            code: "ok",
            legacy: "ok",
            status: "approved",
            reason: "",
          });
          expect(getApplicationStatus).toHaveBeenCalledWith("pandaId");
          expect(response.status).toBe(200);
        });

        it("returns not started when no panda id", async () => {
          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const response = await appClient.application.$get(
            { query: {} },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "not started",
            legacy: "not started",
          });
        });
      });

      describe("submit", () => {
        beforeAll(async () => {
          await database.insert(sources).values([
            {
              id: organizationId,
              config: {
                type: "uphold",
                secrets: { test: { key: "secret", type: "HMAC-SHA256" } },
                webhooks: { sandbox: { url: "https://exa.test", secretId: "test" } },
              },
            },
          ]);
        });

        it("returns ok when payload is valid and kyc is not started", async () => {
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://${domain}`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain,
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };

          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(
                  JSON.stringify({
                    id: "pandaId",
                    applicationStatus: "approved",
                  }),
                ).buffer,
              ),
          } as Response);

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const updatedCredential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const calls = mockFetch.mock.calls;
          const body = calls[0]?.[1]?.body;

          expect(response.status).toBe(200);
          expect(updatedCredential?.pandaId).toBe("pandaId");
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining(`/issuing/applications/user`),
            expect.objectContaining({
              method: "POST",
            }),
          );
          expect(JSON.parse(body as string)).toStrictEqual(applicationPayload);
          await expect(response.json()).resolves.toStrictEqual({ status: "approved" });
        });

        it("accepts postal codes with hyphens and spaces", async () => {
          const payload = {
            ...applicationPayload,
            address: { ...applicationPayload.address, postalCode: "09751-000", countryCode: "BR" },
          };
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(payload) ?? "", "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://${domain}`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain,
          });
          const signature = await owner.signMessage({ message });
          const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };

          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () =>
              Promise.resolve(
                new TextEncoder().encode(JSON.stringify({ id: "pandaId", applicationStatus: "approved" })).buffer,
              ),
          } as Response);

          const response = await appClient.application.$post(
            { json: { ...payload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const body = mockFetch.mock.calls[0]?.[1]?.body;
          expect(response.status).toBe(200);
          expect(JSON.parse(body as string)).toStrictEqual(payload);
          await expect(response.json()).resolves.toStrictEqual({ status: "approved" });
        });

        it("returns 409 when kyc is already started", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://${domain}`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain,
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };

          const submitApplication = vi.spyOn(panda, "submitApplication");

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(409);
          await expect(response.json()).resolves.toStrictEqual({
            code: "already started",
          });
          expect(submitApplication).not.toHaveBeenCalled();
        });

        it("returns 400 when payload is invalid", async () => {
          const response = await app.request("/application", {
            method: "POST",
            headers: { "content-type": "application/json", "test-credential-id": account, SessionID: "fakeSession" },
            body: "{}",
          });

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toMatchObject({
            code: "bad request",
            legacy: "bad request",
          });
        });

        it("returns 400 if terms of service are not accepted", async () => {
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://${domain}`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain,
          });
          const signature = await owner.signMessage({ message });

          const verify = {
            message,
            signature,
            walletAddress: owner.address,
            chainId: chain.id,
          };
          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify, isTermsOfServiceAccepted: false } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
        });

        it("returns 403 when siwe domain does not match expected domain", async () => {
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://phishing.example`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "phishing.example",
          });
          const signature = await owner.signMessage({ message });
          const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
          const submitApplication = vi.spyOn(panda, "submitApplication");

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(403);
          await expect(response.json()).resolves.toStrictEqual({ code: "no permission", message: "invalid domain" });
          expect(submitApplication).not.toHaveBeenCalled();
        });

        it("returns 403 when siwe statement does not match expected statement", async () => {
          const credential = await database.query.credentials.findFirst({
            where: eq(credentials.id, account),
          });
          const expected = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
          const statement = "I apply for KYC approval with a tampered payload";
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce: generateSiweNonce(),
            uri: `https://${domain}`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain,
          });
          const signature = await owner.signMessage({ message });
          const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
          const submitApplication = vi.spyOn(panda, "submitApplication");

          const response = await appClient.application.$post(
            { json: { ...applicationPayload, verify } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(403);
          await expect(response.json()).resolves.toStrictEqual({
            code: "no permission",
            message: `invalid statement, expected: [${expected}] but got [${statement}]`,
          });
          expect(submitApplication).not.toHaveBeenCalled();
        });

        describe("with encrypted payload", () => {
          const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAyZixoAuo015iMt+JND0y
usAvU2iJhtKRM+7uAxd8iXq7Z/3kXlGmoOJAiSNfpLnBAG0SCWslNCBzxf9+2p5t
HGbQUkZGkfrYvpAzmXKsoCrhWkk1HKk9f7hMHsyRlOmXbFmIgQHggEzEArjhkoXD
pl2iMP1ykCY0YAS+ni747DqcDOuFqLrNA138AxLNZdFsySHbxn8fzcfd3X0J/m/T
2dZuy6ChfDZhGZxSJMjJcintFyXKv7RkwrYdtXuqD3IQYakY3u6R1vfcKVZl0yGY
S2kN/NOykbyVL4lgtUzf0IfkwpCHWOrrpQA4yKk3kQRAenP7rOZThdiNNzz4U2BE
2wIDAQAB
-----END PUBLIC KEY-----`;

          function encrypt(payload: string) {
            const aesKey = crypto.randomBytes(32);
            const iv = crypto.randomBytes(12);
            const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
            const ciphertext = Buffer.concat([cipher.update(payload, "utf8"), cipher.final()]);
            const tag = cipher.getAuthTag();
            const key = crypto.publicEncrypt(
              {
                key: publicKey,
                padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha256",
              },
              aesKey,
            );

            return { key, iv, ciphertext, tag };
          }

          it("returns ok when payload is valid", async () => {
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });
            const signature = await owner.signMessage({ message });

            const verify = {
              message,
              signature,
              walletAddress: owner.address,
              chainId: chain.id,
            };

            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
            const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
              ok: true,
              status: 200,
              arrayBuffer: () =>
                Promise.resolve(
                  new TextEncoder().encode(
                    JSON.stringify({
                      id: "pandaId",
                      applicationStatus: "approved",
                    }),
                  ).buffer,
                ),
            } as Response);

            const response = await appClient.application.$post(
              {
                json: {
                  key: encryptedPayload.key.toString("base64"),
                  iv: encryptedPayload.iv.toString("base64"),
                  ciphertext: encryptedPayload.ciphertext.toString("base64"),
                  tag: encryptedPayload.tag.toString("base64"),
                  verify,
                },
              },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            const updatedCredential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const calls = mockFetch.mock.calls;
            const body = calls[0]?.[1]?.body;

            expect(response.status).toBe(200);
            expect(updatedCredential?.pandaId).toBe("pandaId");
            expect(mockFetch).toHaveBeenCalledWith(
              expect.stringContaining("/issuing/applications/user"),
              expect.objectContaining({
                method: "POST",
                headers: expect.objectContaining({ encrypted: "true" }), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
              }),
            );
            expect(JSON.parse(body as string)).toStrictEqual({
              key: encryptedPayload.key.toString("base64"),
              iv: encryptedPayload.iv.toString("base64"),
              ciphertext: encryptedPayload.ciphertext.toString("base64"),
              tag: encryptedPayload.tag.toString("base64"),
            });
            await expect(response.json()).resolves.toStrictEqual({ status: "approved" });
          });

          it("returns 403 no organization", async () => {
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: outsider.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });

            const response = await appClient.application.$post(
              {
                json: {
                  key: encryptedPayload.key.toString("base64"),
                  iv: encryptedPayload.iv.toString("base64"),
                  ciphertext: encryptedPayload.ciphertext.toString("base64"),
                  tag: encryptedPayload.tag.toString("base64"),
                  verify: {
                    message,
                    signature: await outsider.signMessage({ message }),
                    walletAddress: outsider.address,
                    chainId: chain.id,
                  },
                },
              },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            expect(response.status).toBe(403);
          });

          it("returns 403 no permission when organization role is not kyc", async () => {
            await database.update(organizations).set({ role: null }).where(eq(organizations.id, organizationId));
            try {
              const credential = await database.query.credentials.findFirst({ where: eq(credentials.id, account) });
              const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
              const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
              const message = createSiweMessage({
                statement,
                resources: ["https://exactly.github.io/exa"],
                nonce: generateSiweNonce(),
                uri: `https://${domain}`,
                address: owner.address,
                chainId: chain.id,
                scheme: "https",
                version: "1",
                domain,
              });

              const response = await appClient.application.$post(
                {
                  json: {
                    key: encryptedPayload.key.toString("base64"),
                    iv: encryptedPayload.iv.toString("base64"),
                    ciphertext: encryptedPayload.ciphertext.toString("base64"),
                    tag: encryptedPayload.tag.toString("base64"),
                    verify: {
                      message,
                      signature: await owner.signMessage({ message }),
                      walletAddress: owner.address,
                      chainId: chain.id,
                    },
                  },
                },
                { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
              );

              expect(response.status).toBe(403);
              await expect(response.json()).resolves.toStrictEqual({ code: "no permission" });
            } finally {
              await database.update(organizations).set({ role: "kyc" }).where(eq(organizations.id, organizationId));
            }
          });
        });

        describe("panda errors", () => {
          it("returns invalid encryption on bad request", async () => {
            vi.spyOn(panda, "submitApplication").mockRejectedValueOnce(
              new ServiceError("Panda", 400, '{"message":"bad encryption"}', undefined, "bad encryption"),
            );
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });
            const signature = await owner.signMessage({ message });
            const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
            const initialCalls = vi.mocked(captureException).mock.calls.length;

            const response = await appClient.application.$post(
              { json: { ...applicationPayload, verify } },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            expect(response.status).toBe(400);
            await expect(response.json()).resolves.toStrictEqual({
              code: "invalid encryption",
              message: "bad encryption",
            });
            expect(vi.mocked(captureException).mock.calls.slice(initialCalls)).toStrictEqual([]);
          });

          it("returns invalid payload on unauthorized", async () => {
            vi.spyOn(panda, "submitApplication").mockRejectedValueOnce(
              new ServiceError("Panda", 401, '{"message":"invalid data"}', undefined, "invalid data"),
            );
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });
            const signature = await owner.signMessage({ message });
            const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
            const initialCalls = vi.mocked(captureException).mock.calls.length;

            const response = await appClient.application.$post(
              { json: { ...applicationPayload, verify } },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            expect(response.status).toBe(401);
            await expect(response.json()).resolves.toStrictEqual({
              code: "invalid payload",
              message: "invalid data",
            });
            expect(vi.mocked(captureException).mock.calls.slice(initialCalls)).toStrictEqual([]);
          });

          it("propagates panda errors with unexpected status to global handler", async () => {
            vi.spyOn(panda, "submitApplication").mockRejectedValueOnce(
              new ServiceError("Panda", 500, '{"message":"server error"}', undefined, "server error"),
            );
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });
            const signature = await owner.signMessage({ message });
            const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));

            const response = await appClient.application.$post(
              { json: { ...applicationPayload, verify } },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            expect(response.status).toBe(500);
          });

          it("propagates non-panda errors to global handler", async () => {
            vi.spyOn(panda, "submitApplication").mockRejectedValueOnce(new Error("network failure"));
            const credential = await database.query.credentials.findFirst({
              where: eq(credentials.id, account),
            });
            const statement = `I apply for KYC approval on behalf of address ${getAddress(credential?.account ?? "")} with payload hash ${sha256(Buffer.from(canonicalize(applicationPayload) ?? "", "utf8"))}`;
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce: generateSiweNonce(),
              uri: `https://${domain}`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain,
            });
            const signature = await owner.signMessage({ message });
            const verify = { message, signature, walletAddress: owner.address, chainId: chain.id };
            await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));

            const response = await appClient.application.$post(
              { json: { ...applicationPayload, verify } },
              { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
            );

            expect(response.status).toBe(500);
          });
        });
      });

      describe("update", () => {
        it("returns ok when kyc is started", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode("{}").buffer),
          } as Response);

          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const calls = mockFetch.mock.calls;
          const body = calls[0]?.[1]?.body;

          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
          expect(mockFetch).toHaveBeenCalledWith(
            expect.stringContaining(`/issuing/applications/user/pandaId`),
            expect.objectContaining({
              method: "PATCH",
            }),
          );
          expect(JSON.parse(body as string)).toStrictEqual({ firstName: "john-updated" });
        });

        it("accepts postal code updates with hyphens and spaces", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          const mockFetch = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
            ok: true,
            status: 200,
            arrayBuffer: () => Promise.resolve(new TextEncoder().encode("{}").buffer),
          } as Response);

          const json = {
            address: {
              line1: "123 Main St",
              city: "São Paulo",
              region: "SP",
              country: "BR",
              postalCode: "09751-000",
              countryCode: "BR",
            },
          };
          const response = await appClient.application.$patch(
            { json },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          const body = mockFetch.mock.calls[0]?.[1]?.body;
          expect(response.status).toBe(200);
          await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
          expect(JSON.parse(body as string)).toStrictEqual(json);
        });

        it("returns 400 when kyc is not started", async () => {
          await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "not started",
            legacy: "not started",
          });
        });

        it("returns 400 when payload is invalid", async () => {
          const response = await appClient.application.$patch(
            {
              json: {
                address: {
                  line1: "123 main street",
                },
              } as unknown as v.InferOutput<typeof Panda.UpdateApplicationRequest>,
            },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "bad request",
            legacy: "bad request",
            message: expect.any(Array), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
        });

        it("returns 400 when panda rejects the update", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          vi.spyOn(panda, "updateApplication").mockRejectedValueOnce(
            new ServiceError("Panda", 400, '{"message":"application is no longer editable"}'),
          );
          const initialCalls = vi.mocked(captureException).mock.calls.length;

          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toStrictEqual({
            code: "bad request",
            message: ["application is no longer editable"],
          });
          expect(vi.mocked(captureException).mock.calls.slice(initialCalls)).toStrictEqual([]);
        });

        it("propagates panda errors with unexpected status to global handler", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          vi.spyOn(panda, "updateApplication").mockRejectedValueOnce(
            new ServiceError("Panda", 500, '{"message":"server error"}'),
          );

          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(500);
        });

        it("propagates non-panda errors to global handler", async () => {
          await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
          vi.spyOn(panda, "updateApplication").mockRejectedValueOnce(new Error("network failure"));

          const response = await appClient.application.$patch(
            { json: { firstName: "john-updated" } },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(500);
        });
      });
    });

    describe("business application", () => {
      const businessId = "bob-business";
      const businessAccount = parse(Address, padHex("0xb0d", { size: 20 }));

      beforeAll(async () => {
        await database.insert(credentials).values([
          {
            id: businessId,
            publicKey: new Uint8Array(),
            account: businessAccount,
            factory: exaAccountFactoryAddress,
            salt: business,
          },
        ]);
      });

      afterAll(async () => {
        await database.delete(credentials).where(eq(credentials.id, businessId));
      });

      it("returns not started while the business inquiry is pending", async () => {
        vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValue(persona.BUSINESS_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inquiry-id",
          type: "inquiry",
          attributes: { status: "pending", "reference-id": businessId, fields: {} },
        });

        const response = await appClient.index.$get(
          { query: { scope: "business" } },
          { headers: { "test-credential-id": businessId, SessionID: "fakeSession" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "not started",
          legacy: "kyc not started",
        });
      });

      it("returns processing while the business inquiry is completed", async () => {
        vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValue(persona.BUSINESS_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValue({
          id: "inquiry-id",
          type: "inquiry",
          attributes: { status: "completed", "reference-id": businessId, fields: {} },
        });

        const response = await appClient.index.$get(
          { query: { scope: "business" } },
          { headers: { "test-credential-id": businessId, SessionID: "fakeSession" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({ code: "processing", legacy: "kyc not approved" });
      });

      it("returns ok once the business inquiry is approved", async () => {
        const getPendingInquiryTemplate = vi.spyOn(persona, "getPendingInquiryTemplate").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getInquiry = vi.spyOn(persona, "getInquiry");

        const response = await appClient.index.$get(
          { query: { scope: "business" } },
          { headers: { "test-credential-id": businessId, SessionID: "fakeSession" } },
        );

        expect(response.status).toBe(200);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(businessId, "business");
        expect(getInquiry).not.toHaveBeenCalled();
        expect(captureException).not.toHaveBeenCalled();
      });
    });
  });
});

const basicAccount = {
  type: "account" as const,
  id: "test-account-id",
  attributes: {
    "reference-id": "test-reference-id",
    "created-at": "2025-12-01T00:00:00.000Z",
    "updated-at": "2025-12-01T00:00:00.000Z",
    "redacted-at": null,
    "account-type-name": "User",
    fields: {
      name: {
        type: "hash",
        value: {
          first: {
            type: "string",
            value: "ALEXANDER J",
          },
          middle: {
            type: "string",
            value: null,
          },
          last: {
            type: "string",
            value: "SAMPLE",
          },
        },
      },
      address: {
        type: "hash",
        value: {
          street_1: {
            type: "string",
            value: "600 CALIFORNIA STREET",
          },
          street_2: {
            type: "string",
            value: null,
          },
          city: {
            type: "string",
            value: "SAN FRANCISCO",
          },
          subdivision: {
            type: "string",
            value: "CA",
          },
          postal_code: {
            type: "string",
            value: "94109",
          },
          country_code: {
            type: "string",
            value: "US",
          },
        },
      },
      identification_numbers: {
        type: "array",
        value: [
          {
            type: "hash",
            value: {
              identification_class: {
                type: "string",
                value: "dl",
              },
              identification_number: {
                type: "string",
                value: "I1234562",
              },
              issuing_country: {
                type: "string",
                value: "US",
              },
            },
          },
        ],
      },
      birthdate: {
        type: "date",
        value: "1977-07-17",
      },
      phone_number: {
        type: "string",
        value: "+1234567890",
      },
      email_address: {
        type: "string",
        value: "example@example.com",
      },
      selfie_photo: {
        type: "file",
        value: {
          filename: "selfie.jpg",
          byte_size: 20_723,
          url: "https://url.to.selfie.photo",
        },
      },
      tin: {
        type: "string",
        value: null,
      },
      isnotfacta: {
        // cspell:ignore isnotfacta
        type: "boolean",
        value: null,
      },
      manteca_t_c: {
        type: "boolean",
        value: null,
      },
      rain_e_sign_consent: {
        type: "boolean",
        value: true,
      },
      exa_card_tc: {
        type: "boolean",
        value: true,
      },
      privacy__policy: {
        type: "boolean",
        value: true,
      },
      sex_1: {
        type: "string",
        value: null,
      },
      account_opening_disclosure: {
        type: "boolean",
        value: true,
      },
      economic_activity: {
        type: "string",
        value: "Engineer",
      },
      annual_salary: {
        type: "string",
        value: "100000",
      },
      expected_monthly_volume: {
        type: "string",
        value: "1000",
      },
      accurate_info_confirmation: {
        type: "boolean",
        value: true,
      },
      non_unauthorized_solicitation: {
        type: "boolean",
        value: true,
      },
      non_illegal_activities_2: {
        type: "string",
        value: "No",
      },
      documents: {
        type: "array",
        value: [
          {
            type: "hash",
            value: {
              id_class: {
                type: "string",
                value: "dl",
              },
              id_number: {
                type: "string",
                value: "1234567890",
              },
              id_issuing_country: {
                type: "string",
                value: "US",
              },
              id_document_id: {
                type: "string",
                value: "doc_1234567890",
              },
            },
          },
        ],
      },
    },
    "name-first": "ALEXANDER J",
    "name-middle": null,
    "name-last": "SAMPLE",
    "social-security-number": null,
    "address-street-1": "600 CALIFORNIA STREET",
    "address-street-2": null,
    "address-city": "SAN FRANCISCO",
    "address-subdivision": "CA",
    "address-postal-code": "94109",
    "country-code": "AR",
    birthdate: "1977-07-17",
    "phone-number": "+1234567890",
    "email-address": "example@example.com",
    tags: [],
    "account-status": "Default",
    "identification-numbers": {
      dl: [
        {
          "issuing-country": "US",
          "identification-class": "dl",
          "identification-number": "I1234562",
          "created-at": "2025-12-11T00:00:00.000Z",
          "updated-at": "2025-12-11T00:00:00.000Z",
        },
      ],
    },
  },
};

const mantecaAccount = {
  ...basicAccount,
  attributes: {
    ...basicAccount.attributes,
    fields: {
      ...basicAccount.attributes.fields,
      tin: { type: "string", value: "12345678" },
      manteca_t_c: { type: "boolean", value: true },
      sex_1: { type: "string", value: "Male" },
      isnotfacta: { type: "boolean", value: true },
    },
  },
};

const personaTemplate = {
  id: "test-id",
  type: "inquiry" as const,
  attributes: {
    status: "approved" as const,
    "reference-id": "ref-123",
    "name-first": "John",
    "name-middle": null,
    "name-last": "Doe",
    "email-address": "john@example.com",
    "phone-number": "+1234567890",
    birthdate: "1990-01-01",
    fields: { "input-select": { type: "choices", value: "John" } },
  } as const,
  relationships: {
    documents: { data: [{ type: "document", id: "1234567890" }] },
    account: { data: { id: "1234567890", type: "account" } } as const,
  },
};

const resumeTemplate = {
  data: {
    id: "test-id",
    type: "inquiry" as const,
    attributes: {
      status: "approved" as const,
      fields: {
        "name-first": { type: "string", value: "John" },
        "name-middle": { type: "string", value: null },
        "name-last": { type: "string", value: "Doe" },
        "email-address": { type: "string", value: "john@example.com" },
        "phone-number": { type: "string", value: "+1234567890" },
        birthdate: { type: "string", value: "1990-01-01" },
      },
      "reference-id": "ref-123",
    },
  },
  meta: {
    "session-token": "fakeSession",
  },
} as const;

const inquiry = {
  data: {
    id: "test-id",
    type: "inquiry",
    attributes: {
      status: "created",
      "reference-id": "ref-123",
    },
  },
} as const;
