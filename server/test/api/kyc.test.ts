import "../mocks/auth";

import "../mocks/database";
import "../mocks/deployments";
import "../mocks/sentry";

import deriveAddress from "@exactly/common/deriveAddress";
import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { padHex, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/kyc";
import database, { credentials } from "../../database";
import * as persona from "../../utils/persona";

const appClient = testClient(app);

describe("authenticated", () => {
  const bob = privateKeyToAddress(generatePrivateKey());
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: account,
      publicKey: new Uint8Array(),
      account,
      factory: inject("ExaAccountFactory"),
      pandaId: "pandaId",
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("basic scope", () => {
    describe("getting kyc", () => {
      it("is the default scope", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await appClient.index.$get({ query: {} }, { headers: { "test-credential-id": account } });

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
      });

      it("returns ok kyc approved with country code when panda id is present", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
        const getInquiry = vi.spyOn(persona, "getInquiry");
        const getAccount = vi
          .spyOn(persona, "getAccount")
          .mockResolvedValueOnce(basicAccount as persona.AccountOutput<"basic">);

        const response = await appClient.index.$get(
          { query: { countryCode: "true", scope: "basic" } },
          { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
        );

        expect(getAccount).toHaveBeenCalledOnce();
        expect(getInquiry).not.toHaveBeenCalled();
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.headers.get("User-Country")).toBe("AR");
        expect(response.status).toBe(200);
      });

      it("returns ok code when account has all fields", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
      });

      it("returns not started when inquiry is not found", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns ok and sends sentry error if template is required but inquiry is approved", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
        expect(response.status).toBe(200);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: account } },
        });
      });

      it("returns not started when inquiry is created", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "created" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns not started when inquiry is pending", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "pending" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns not started when inquiry is expired", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "expired" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "not started", legacy: "kyc not started" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry is completed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "completed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry needs review", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "needs_review" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });

      it("returns bad kyc when inquiry failed", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "failed" },
        });

        const response = await appClient.index.$get(
          { query: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "bad kyc", legacy: "kyc not approved" });
        expect(response.status).toBe(400);
      });
    });

    describe("posting kyc", () => {
      it("is the default scope", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        await appClient.index.$post(
          { json: {} },
          { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
      });

      it("returns already approved when account has all fields", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(undefined); // eslint-disable-line unicorn/no-useless-undefined

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
      });

      it("returns already approved and sends sentry error when template is required but inquiry is approved", async () => {
        await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
        const getPendingInquiryTemplate = vi
          .spyOn(persona, "getPendingInquiryTemplate")
          .mockResolvedValueOnce(persona.PANDA_TEMPLATE);
        vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
          ...personaTemplate,
          attributes: { ...personaTemplate.attributes, status: "approved" },
        });

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        await expect(response.json()).resolves.toStrictEqual({
          code: "already approved",
          legacy: "kyc already approved",
        });
        expect(response.status).toBe(400);
        expect(captureException).toHaveBeenCalledWith(new Error("inquiry approved but account not updated"), {
          contexts: { inquiry: { templateId: persona.PANDA_TEMPLATE, referenceId: account } },
        });
      });

      it("returns OTL and session token when creating inquiry", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));

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
        const createInquiryFromTemplate = vi
          .spyOn(persona, "createInquiryFromTemplate")
          .mockResolvedValueOnce(OTLTemplate);

        const response = await appClient.index.$post(
          { json: { scope: "basic" } },
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(createInquiryFromTemplate).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE, undefined);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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
          { headers: { "test-credential-id": account } },
        );

        expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
        expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
        await expect(response.json()).resolves.toStrictEqual({ code: "failed", legacy: "kyc failed" });
        expect(response.status).toBe(400);
      });
    });
  });

  describe("legacy kyc flow", () => {
    it("returns ok kyc approved with country code", async () => {
      await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
      const getInquiry = vi.spyOn(persona, "getInquiry");
      const getAccount = vi
        .spyOn(persona, "getAccount")
        .mockResolvedValueOnce(basicAccount as persona.AccountOutput<"basic">);

      const response = await appClient.index.$get(
        { query: { countryCode: "true" } },
        { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
      );

      expect(getAccount).toHaveBeenCalledOnce();
      expect(getInquiry).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.headers.get("User-Country")).toBe("AR");
      expect(response.status).toBe(200);
    });

    it("returns ok kyc approved when panda id is present", async () => {
      await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, account));
      const getInquiry = vi.spyOn(persona, "getInquiry");
      const getAccount = vi.spyOn(persona, "getAccount");

      const response = await appClient.index.$get(
        { query: {} },
        { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
      );

      expect(getAccount).not.toHaveBeenCalled();
      expect(getInquiry).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      expect(response.status).toBe(200);
    });

    it("resumes inquiry with template", async () => {
      await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
      const templateId = persona.PANDA_TEMPLATE;
      const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
        ...personaTemplate,
        attributes: { ...personaTemplate.attributes, status: "pending" },
      });
      const resumeInquiry = vi.spyOn(persona, "resumeInquiry").mockResolvedValueOnce(resumeTemplate);

      const response = await appClient.index.$get(
        { query: { templateId } },
        { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
      );

      expect(getInquiry).toHaveBeenCalledWith(account, templateId);
      expect(resumeInquiry).toHaveBeenCalledWith(resumeTemplate.data.id);
      await expect(response.json()).resolves.toStrictEqual({
        inquiryId: resumeTemplate.data.id,
        sessionToken: resumeTemplate.meta["session-token"],
      });
      expect(response.status).toBe(200);
    });

    it("returns OTL and session token when creating inquiry", async () => {
      await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));

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
      const createInquiryFromTemplate = vi
        .spyOn(persona, "createInquiryFromTemplate")
        .mockResolvedValueOnce(OTLTemplate);

      const response = await appClient.index.$post(
        { json: {} },
        { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
      expect(createInquiryFromTemplate).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE, undefined);
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
        { headers: { "test-credential-id": account } },
      );

      expect(getPendingInquiryTemplate).toHaveBeenCalledWith(account, "basic");
      expect(getInquiry).toHaveBeenCalledWith(account, persona.PANDA_TEMPLATE);
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

vi.mock("@sentry/node", { spy: true });
