import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import canonicalize from "canonicalize";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import crypto from "node:crypto";
import { getAddress, padHex, sha256, zeroAddress, zeroHash } from "viem";
import { mnemonicToAccount, privateKeyToAddress } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { afterEach, beforeAll, beforeEach, describe, expect, inject, it, vi } from "vitest";

import deriveAddress from "@exactly/common/deriveAddress";
import chain from "@exactly/common/generated/chain";

import app from "../../api/kyc";
import database, { credentials, sources } from "../../database";
import auth from "../../utils/auth";
import * as panda from "../../utils/panda";
import * as persona from "../../utils/persona";
import { scopeValidationErrors } from "../../utils/persona";
import publicClient from "../../utils/publicClient";

import type * as v from "valibot";

const appClient = testClient(app);

vi.mock("@sentry/node", { spy: true });

describe("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b2"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values([
      {
        id: account,
        publicKey: new Uint8Array(),
        account,
        factory: zeroAddress,
        pandaId: "pandaId",
      },
    ]);
  });

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

  describe("application", () => {
    describe("with organization", () => {
      const owner = mnemonicToAccount("test test test test test test test test test test test kyc");
      const ownerHeaders: Headers = new Headers();
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
          uri: `https://localhost`,
          address: owner.address,
          chainId: chain.id,
          scheme: "https",
          version: "1",
          domain: "localhost",
        });

        const adminResponse = await auth.api.verifySiweMessage({
          body: {
            message: ownerMessage,
            signature: await owner.signMessage({ message: ownerMessage }),
            walletAddress: owner.address,
            chainId: chain.id,
          },
          request: new Request("https://localhost"),
          asResponse: true,
        });
        ownerHeaders.set("cookie", `${adminResponse.headers.get("set-cookie")}`);

        const externalOrganization = await auth.api.createOrganization({
          headers: ownerHeaders,
          body: {
            name: "Organization",
            slug: "organization",
            keepCurrentActiveOrganization: false,
          },
        });
        organizationId = externalOrganization?.id ?? "";
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
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const { nonce } = await auth.api.getSiweNonce({
            body: { walletAddress: owner.address, chainId: chain.id },
          });
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce,
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
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
          expect(JSON.parse(body as string)).toStrictEqual({ ...applicationPayload, verify });
          await expect(response.json()).resolves.toStrictEqual({ id: "pandaId", status: "approved" });
        });

        it("returns 401 when kyc is already started", async () => {
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const { nonce } = await auth.api.getSiweNonce({
            body: { walletAddress: owner.address, chainId: chain.id },
          });
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce,
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
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

          expect(response.status).toBe(401);
          await expect(response.json()).resolves.toStrictEqual({
            code: "already started",
          });
          expect(submitApplication).not.toHaveBeenCalled();
        });

        it("returns 400 when payload is invalid", async () => {
          const response = await appClient.application.$post(
            { json: {} as unknown as v.InferOutput<typeof panda.SubmitApplicationRequest> },
            { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
          );

          expect(response.status).toBe(400);
          await expect(response.json()).resolves.toMatchObject({
            code: "bad request",
            legacy: "bad request",
            message: expect.any(Array), // eslint-disable-line @typescript-eslint/no-unsafe-assignment
          });
        });

        it("returns 400 if terms of service are not accepted", async () => {
          const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(Buffer.from(JSON.stringify(canonicalize(applicationPayload)), "utf8"))}`;
          const { nonce } = await auth.api.getSiweNonce({
            body: { walletAddress: owner.address, chainId: chain.id },
          });
          const message = createSiweMessage({
            statement,
            resources: ["https://exactly.github.io/exa"],
            nonce,
            uri: `https://sandbox.exactly.app`,
            address: owner.address,
            chainId: chain.id,
            scheme: "https",
            version: "1",
            domain: "sandbox.exactly.app",
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
            const encryptedPayload = encrypt(JSON.stringify(applicationPayload));
            const statement = `I apply for KYC approval on behalf of address ${getAddress(account)} with payload hash ${sha256(encryptedPayload.ciphertext)}`;
            const { nonce } = await auth.api.getSiweNonce({
              body: { walletAddress: owner.address, chainId: chain.id },
            });
            const message = createSiweMessage({
              statement,
              resources: ["https://exactly.github.io/exa"],
              nonce,
              uri: `https://sandbox.exactly.app`,
              address: owner.address,
              chainId: chain.id,
              scheme: "https",
              version: "1",
              domain: "sandbox.exactly.app",
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
              { headers: { "test-credential-id": account, SessionID: "fakeSession", encrypted: "true" } },
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
            expect(JSON.parse(body as string)).toStrictEqual({
              key: encryptedPayload.key.toString("base64"),
              iv: encryptedPayload.iv.toString("base64"),
              ciphertext: encryptedPayload.ciphertext.toString("base64"),
              tag: encryptedPayload.tag.toString("base64"),
              verify,
            });
            await expect(response.json()).resolves.toStrictEqual({ id: "pandaId", status: "approved" });
          });
        });
      });

      describe("update", () => {
        it("returns ok when kyc is started", async () => {
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
              } as unknown as v.InferOutput<typeof panda.UpdateApplicationRequest>,
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
      });
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

const applicationPayload = {
  firstName: "john",
  lastName: "doe",
  birthDate: "1990-01-15",
  nationalId: "123456789",
  countryOfIssue: "AA",
  email: "john.doe@example.com",
  phoneCountryCode: "1",
  phoneNumber: "5551234567",
  ipAddress: "192.168.1.1",
  occupation: "occupation",
  annualSalary: "1234",
  accountPurpose: "purpose",
  expectedMonthlyVolume: "1234",
  isTermsOfServiceAccepted: true,
  address: {
    line1: "123 main street",
    line2: "apt 1",
    city: "city",
    region: "region",
    postalCode: "1234",
    countryCode: "AA",
    country: "country",
  },
} as const;
