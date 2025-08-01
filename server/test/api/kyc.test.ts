import "../mocks/sentry";
import "../mocks/auth";
import "../mocks/database";
import "../mocks/deployments";

import deriveAddress from "@exactly/common/deriveAddress";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import type { InferOutput } from "valibot";
import { zeroHash, padHex, zeroAddress } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import app from "../../api/kyc";
import database, { credentials, sources } from "../../database";
import * as kyc from "../../utils/kyc";
import * as panda from "../../utils/panda";
import * as persona from "../../utils/persona";

const appClient = testClient(app);

describe("authenticated", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok kyc approved without template", async () => {
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(personaTemplate);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...personaTemplate,
      type: "account",
      attributes: { "country-code": "AR" },
    });

    const response = await appClient.index.$get(
      { query: {} },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, "itmpl_8uim4FvD5P3kFpKHX37CW817");
    expect(getAccount).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
    expect(response.headers.get("User-Country")).toBe("AR");
    expect(response.status).toBe(200);
  });

  it("resumes inquiry with template", async () => {
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

  it("returns OTL link", async () => {
    const otl = "https://new-url.com";
    const generateOTL = vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
      ...OTLTemplate,
      meta: { ...OTLTemplate.meta, "one-time-link": otl },
    });
    let templateId;
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(templateId);
    const createInquiry = vi.spyOn(persona, "createInquiry").mockResolvedValueOnce(OTLTemplate);

    const response = await appClient.index.$post(
      { json: {} },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, persona.CRYPTOMATE_TEMPLATE);
    expect(createInquiry).toHaveBeenCalledWith(account, undefined);
    expect(generateOTL).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({ otl, legacy: otl });
    expect(response.status).toBe(200);
  });

  it("returns OTL link when resuming inquiry", async () => {
    const templateId = "template";
    const otl = "https://resume-url.com";
    const generateOTL = vi.spyOn(persona, "generateOTL").mockResolvedValueOnce({
      ...OTLTemplate,
      meta: { ...OTLTemplate.meta, "one-time-link": otl },
    });

    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce({
      ...personaTemplate,
      attributes: { ...personaTemplate.attributes, status: "created" },
    });
    const response = await appClient.index.$post(
      { json: { templateId } },
      { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith(account, templateId);
    expect(generateOTL).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({ otl, legacy: otl });
    expect(response.status).toBe(200);
  });

  describe("application", () => {
    describe("status", () => {
      it("returns status", async () => {
        const getApplicationStatus = vi.spyOn(kyc, "getApplicationStatus").mockResolvedValueOnce({
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
            id: "uphold",
            config: {
              type: "uphold",
              secrets: { test: { key: "secret", type: "HMAC-SHA256" } },
              webhooks: { sandbox: { url: "https://exa.test", secretId: "test" } },
            },
          },
        ]);
      });

      it("returns ok when payload is valid and kyc is not started", async () => {
        await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, account));
        const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
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
          { json: applicationPayload },
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
          `${panda.baseURL}/issuing/applications/user`,
          expect.objectContaining({
            method: "POST",
          }),
        );
        expect(JSON.parse(body as string)).toStrictEqual(applicationPayload);
        await expect(response.json()).resolves.toStrictEqual({ code: "ok", legacy: "ok" });
      });

      it("returns 400 when kyc is already started", async () => {
        const submitApplication = vi.spyOn(kyc, "submitApplication");

        const response = await appClient.application.$post(
          { json: applicationPayload },
          { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "already started",
          legacy: "already started",
        });
        expect(submitApplication).not.toHaveBeenCalled();
      });

      it("returns 400 when payload is invalid", async () => {
        const response = await appClient.application.$post(
          { json: {} as unknown as InferOutput<typeof kyc.SubmitApplicationRequest> },
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
        const response = await appClient.application.$post(
          { json: { ...applicationPayload, isTermsOfServiceAccepted: false } },
          { headers: { "test-credential-id": account, SessionID: "fakeSession" } },
        );

        expect(response.status).toBe(400);
        await expect(response.json()).resolves.toStrictEqual({
          code: "bad request",
          legacy: "bad request",
          message: ["isTermsOfServiceAccepted Invalid type: Expected true but received false"],
        });
      });
    });

    describe("update", () => {
      it("returns ok when kyc is started", async () => {
        const mockFetch = vi.spyOn(global, "fetch").mockResolvedValueOnce({
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
          `${panda.baseURL}/issuing/applications/user/pandaId`,
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
            } as unknown as InferOutput<typeof kyc.UpdateApplicationRequest>,
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
  },
} as const;

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
};
