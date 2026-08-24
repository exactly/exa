import "../mocks/sentry";

import { describe, expect, it, vi } from "vitest";

import { BusinessApplicationError, businessProfile } from "../../utils/business";
import createPersona from "../../utils/persona";

const persona = createPersona("persona", "https://persona.test");

describe("business profile", () => {
  const fields = {
    collected_email_address: { value: "jane@example.com" },
    company_description: { value: "Account software" },
    i_company_name: { value: "Account Acme" },
  };

  function mockBusiness({
    accountFields = fields,
    accountReferenceId = "reference-id",
    inquiryFields = {},
    inquiryStatus = "completed",
  }: {
    accountFields?: unknown;
    accountReferenceId?: string;
    inquiryFields?: Record<string, { value: unknown }>;
    inquiryStatus?:
      | "approved"
      | "completed"
      | "created"
      | "declined"
      | "expired"
      | "failed"
      | "needs_review"
      | "pending";
  } = {}) {
    vi.spyOn(persona, "getInquiry").mockResolvedValue({
      id: "inquiry-id",
      type: "inquiry",
      attributes: { fields: inquiryFields, status: inquiryStatus, "reference-id": "reference-id" },
    });
    vi.spyOn(persona, "getAccount").mockResolvedValue({
      id: "account-id",
      type: "account",
      attributes: { fields: accountFields, "reference-id": accountReferenceId },
      relationships: { "account-type": { data: { id: "acttp_company" } } },
    } as never);
  }

  it("returns the required business fields", async () => {
    mockBusiness();

    await expect(businessProfile("reference-id", persona)).resolves.toStrictEqual({
      email: "jane@example.com",
      fields,
      name: "Account Acme",
    });
  });

  it("prefers an account field over an inquiry field", async () => {
    mockBusiness({ inquiryFields: { "company-description": { value: "Inquiry software" } } });

    const { fields: result } = await businessProfile("reference-id", persona);

    expect(result.company_description?.value).toBe("Account software");
  });

  it("falls back to a normalized inquiry field when the account field is blank", async () => {
    mockBusiness({
      accountFields: { ...fields, company_description: { value: "" } },
      inquiryFields: { "company-description": { value: "Inquiry software" } },
    });

    const { fields: result } = await businessProfile("reference-id", persona);

    expect(result.company_description?.value).toBe("Inquiry software");
  });

  it("trims a padded required field", async () => {
    mockBusiness({ accountFields: { ...fields, i_company_name: { value: " Account Acme " } } });

    await expect(businessProfile("reference-id", persona)).resolves.toMatchObject({ name: "Account Acme" });
  });

  it("rejects a missing inquiry", async () => {
    vi.spyOn(persona, "getInquiry").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "business inquiry not started",
      code: "not started",
    });
  });

  it("rejects a mismatched inquiry reference id", async () => {
    mockBusiness();

    await expect(businessProfile("other-reference-id", persona)).rejects.toBeInstanceOf(BusinessApplicationError);
  });

  it.each([
    ["created", "business inquiry is not started", "not started"],
    ["expired", "business inquiry is not started", "not started"],
    ["pending", "business inquiry is not started", "not started"],
    ["failed", "business inquiry failed", "bad kyb"],
    ["declined", "business inquiry failed", "bad kyb"],
    ["needs_review", "business inquiry is not complete", "processing"],
  ] as const)("rejects a %s inquiry", async (inquiryStatus, message, code) => {
    mockBusiness({ inquiryStatus });

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({ message, code });
  });

  it("rejects a missing business account", async () => {
    mockBusiness();
    vi.mocked(persona.getAccount).mockImplementationOnce(() => Promise.resolve(undefined)); // eslint-disable-line unicorn/no-useless-undefined

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "business account not started",
      code: "not started",
    });
  });

  it("rejects malformed business account attributes", async () => {
    mockBusiness({ accountFields: { company_name: "malformed" } });

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "business account is not complete",
      code: "processing",
    });
  });

  it("rejects a mismatched business account", async () => {
    mockBusiness({ accountReferenceId: "other-reference-id" });

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "business account is not complete",
      code: "processing",
    });
  });

  it.each([["i_company_name"], ["collected_email_address"]] as const)("rejects a missing %s", async (name) => {
    mockBusiness({ accountFields: { ...fields, [name]: { value: "" } } });

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "business account is not complete",
      code: "processing",
    });
  });

  it("rejects a business field with the wrong type", async () => {
    mockBusiness({ accountFields: { ...fields, i_company_name: { value: 123 } } });

    await expect(businessProfile("reference-id", persona)).rejects.toMatchObject({
      message: "invalid business Persona fields",
      code: "bad request",
    });
  });
});
