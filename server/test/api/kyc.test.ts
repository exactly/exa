import "../mocks/auth";
import "../mocks/deployments";
import "../mocks/sentry";

import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { afterEach, describe, expect, it, vi } from "vitest";

import app from "../../api/kyc";
import database, { credentials } from "../../database";
import * as persona from "../../utils/persona";

const appClient = testClient(app);

describe("authenticated", () => {
  afterEach(() => vi.restoreAllMocks());

  it("returns ok kyc approved with country code", async () => {
    await database.update(credentials).set({ pandaId: "pandaId" }).where(eq(credentials.id, "bob"));
    const getInquiry = vi.spyOn(persona, "getInquiry");
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...personaTemplate,
      type: "account",
      attributes: {
        "country-code": "AR",
        "social-security-number": null,
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "New York",
        "address-subdivision": null,
        "address-postal-code": "10001",
        fields: {},
      },
    });

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

  it("returns ok kyc approved without template", async () => {
    await database.update(credentials).set({ pandaId: null }).where(eq(credentials.id, "bob"));
    const getInquiry = vi.spyOn(persona, "getInquiry").mockResolvedValueOnce(personaTemplate);
    const getAccount = vi.spyOn(persona, "getAccount").mockResolvedValueOnce({
      ...personaTemplate,
      type: "account",
      attributes: {
        "country-code": "AR",
        "social-security-number": null,
        "address-street-1": "123 Main St",
        "address-street-2": null,
        "address-city": "New York",
        "address-subdivision": null,
        "address-postal-code": "10001",
        fields: {},
      },
    });

    const response = await appClient.index.$get(
      { query: {} },
      { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith("bob", "itmpl_8uim4FvD5P3kFpKHX37CW817");
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
      { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith("bob", persona.CRYPTOMATE_TEMPLATE);
    expect(createInquiry).toHaveBeenCalledWith("bob", undefined);
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
      { headers: { "test-credential-id": "bob", SessionID: "fakeSession" } },
    );

    expect(getInquiry).toHaveBeenCalledWith("bob", templateId);
    expect(generateOTL).toHaveBeenCalledWith(resumeTemplate.data.id);
    await expect(response.json()).resolves.toStrictEqual({ otl, legacy: otl });
    expect(response.status).toBe(200);
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
