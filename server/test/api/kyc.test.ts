import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/kyc";
import database, { credentials } from "../../database";
import * as persona from "../../utils/persona";
import { scopeValidationErrors } from "../../utils/persona";
import publicClient from "../../utils/publicClient";

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
          .mockResolvedValueOnce(basicAccount as persona.AccountOutput<"basic">);

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

      it("returns bad kyc when inquiry is completed", async () => {
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
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry needs review", async () => {
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
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
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

      it("returns OTL and session token when creating inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const otl = "https://new-url.com";
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns OTL link and session token when resuming created inquiry", async () => {
        const otl = "https://resume-url.com";
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns OTL link and session token when resuming pending inquiry", async () => {
        const otl = "https://resume-url.com";
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns OTL link and session token when resuming expired inquiry", async () => {
        const otl = "https://resume-url.com";
        const sessionToken = "persona-session-token";

        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
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

      it("returns failed kyc when inquiry is completed", async () => {
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
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });

      it("returns failed kyc when inquiry needs review", async () => {
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
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
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
        .set({ pandaId: null, factory: inject("ExaAccountFactory") })
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
      const readContract = vi.spyOn(publicClient, "readContract").mockResolvedValueOnce([inject("ExaPlugin")]);
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
        vi.spyOn(persona, "getAccount").mockResolvedValueOnce(mantecaAccount as persona.AccountOutput<"manteca">);
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

      it("returns otl and session token when creating manteca extra fields inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const otl = "https://new-manteca-url.com";
        const sessionToken = "manteca-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns otl and session token when creating manteca with id class inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

        const otl = "https://new-manteca-id-url.com";
        const sessionToken = "manteca-id-session-token";

        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
          inquiryId: resumeTemplate.data.id,
        });
        expect(response.status).toBe(200);
      });

      it("returns otl and session token when resuming pending manteca inquiry", async () => {
        const otl = "https://resume-manteca-url.com";
        const sessionToken = "resume-manteca-session-token";

        vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
          ...OTLTemplate,
          meta: { ...OTLTemplate.meta, "one-time-link": otl },
        });
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
          otl,
          sessionToken,
          legacy: otl,
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

  describe("legacy kyc flow", () => {
    it("returns ok kyc approved with country code", async () => {
      await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
      const getInquiry = vi.spyOn(persona, "getInquiry");
      const getAccount = vi
        .spyOn(persona, "getAccount")
        .mockResolvedValueOnce(basicAccount as persona.AccountOutput<"basic">);

      const response = await appClient.index.$get(
        { query: { countryCode: "true" } },
        { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
      );

      expect(getAccount).toHaveBeenCalledOnce();
      expect(getInquiry).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.headers.get("User-Country")).toBe("AR");
      expect(response.status).toBe(200);
    });

    it("returns ok kyc approved when panda id is present", async () => {
      await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
      const getInquiry = vi.spyOn(persona, "getInquiry");
      const getAccount = vi.spyOn(persona, "getAccount");

      const response = await appClient.index.$get(
        { query: {} },
        { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
      );

      expect(getAccount).not.toHaveBeenCalled();
      expect(getInquiry).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("resumes inquiry with template", async () => {
      await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
      const templateId = persona.PANDA_TEMPLATE;
      const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
        ...personaTemplate,
        attributes: { ...personaTemplate.attributes, status: "pending" },
      });
      const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

      const response = await appClient.index.$get(
        { query: { templateId } },
        { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
      );

      expect(getInquiry).toHaveBeenCalledWith("bob", templateId);
      expect(resumeInquiry).toHaveBeenCalledWith(resumeTemplate.data.id);
      await expect(response.json()).resolves.toStrictEqual({
        inquiryId: resumeTemplate.data.id,
        sessionToken: resumeTemplate.meta["session-token"],
      });
      expect(response.status).toBe(200);
    });

    it("returns OTL and session token when creating inquiry", async () => {
      await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));

      const otl = "https://new-url.com";
      const sessionToken = "persona-session-token";

      vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
        ...OTLTemplate,
        meta: { ...OTLTemplate.meta, "one-time-link": otl },
      });
      vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce({
        ...resumeTemplate,
        meta: { ...resumeTemplate.meta, "session-token": sessionToken },
      });
      vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

      const getPendingInquiryTemplate = vi
        .spyOn(persona, "getPendingInquiryTemplate")
        .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
      const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(OTLTemplate);

      const response = await appClient.index.$post(
        { json: {} },
        { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      expect(createInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE, undefined);
      await expect(response.json()).resolves.toStrictEqual({
        otl,
        sessionToken,
        legacy: otl,
        inquiryId: resumeTemplate.data.id,
      });
      expect(response.status).toBe(200);
    });

    it("returns OTL link and session token when resuming inquiry", async () => {
      const templateId = "template";
      const otl = "https://resume-url.com";
      const sessionToken = "persona-session-token";

      vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
        ...OTLTemplate,
        meta: { ...OTLTemplate.meta, "one-time-link": otl },
      });
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
        { json: { templateId } },
        { headers: { "test-credential-id": "bob" } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith("bob", "basic");
      expect(getInquiry).toHaveBeenCalledWith("bob", persona.PANDA_TEMPLATE);
      await expect(response.json()).resolves.toStrictEqual({
        otl,
        sessionToken,
        legacy: otl,
        inquiryId: resumeTemplate.data.id,
      });
      expect(response.status).toBe(200);
    });
  });
});

const basicAccount = {
  type: "account",
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

const OTLTemplate = {
  data: {
    attributes: {
      status: "created",
      "reference-id": "ref-123",
    },
    id: "test-id",
    type: "inquiry",
  },
  meta: {
    "one-time-link": "a link",
    "one-time-link-short": "",
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
