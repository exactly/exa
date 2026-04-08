import "../mocks/persona";
import "../mocks/sentry";

import { captureException } from "@sentry/node";
import { array, minLength, number, object, optional, pipe, safeParse, string, union } from "valibot";
import { baseSepolia, optimism } from "viem/chains";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import * as persona from "../../utils/persona";

const chainMock = vi.hoisted(() => ({ id: 10 }));

vi.mock("@exactly/common/generated/chain", () => ({
  default: chainMock,
}));

vi.mock("../../utils/panda");
vi.mock("../../utils/pax");

vi.mock("@sentry/node", { spy: true });

describe("is missing or null util", () => {
  const schema = object({
    field1: string(),
    field2: optional(string()),
    array: pipe(
      array(
        object({
          arrayField1: string(),
          arrayField2: optional(string()),
        }),
      ),
      minLength(1),
    ),
    union: union(
      [
        object({ field1: string(), field1optional: optional(string()) }),
        object({ field2: number(), field2optional: optional(number()) }),
      ],
      "error message",
    ),
    nested: object({
      nestedField1: string(),
      nestedField2: optional(string()),
      nestedArray: array(string()),
    }),
  });

  it("returns true if field is null or undefined", () => {
    const result = safeParse(schema, {
      field1: null,
      array: [{ arrayField1: "test" }],
      union: { field1: "test" },
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue && persona.isMissingOrNull(issue)).toBe(true);
  });

  it("returns false if field is not valid", () => {
    const result = safeParse(schema, {
      field1: 123,
      array: [{ arrayField1: "test" }],
      union: { field1: "test" },
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue && persona.isMissingOrNull(issue)).toBe(false);
  });

  it("returns true if nested field is null or undefined", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [{ arrayField1: "test" }],
      union: { field1: "test" },
      nested: {
        nestedField1: null,
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues?.length).toBe(1);
    expect(issue && persona.isMissingOrNull(issue)).toBe(true);
  });

  it("returns true if union is null or undefined", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [{ arrayField1: "test" }],
      union: null,
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue?.issues).toHaveLength(2);
    expect(issue && persona.isMissingOrNull(issue)).toBe(true);
  });

  it("returns true if union is defined but all sub issues are undefined or null", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [{ arrayField1: "test" }],
      union: { field2: null },
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue?.issues).toHaveLength(2);
    expect(issue && persona.isMissingOrNull(issue)).toBe(true);
  });

  it("returns false if union is defined and at least one sub issue is not undefined or null", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [{ arrayField1: "test" }],
      union: { field2: "test", field2optional: 123 },
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue?.issues).toHaveLength(2);
    expect(issue && persona.isMissingOrNull(issue)).toBe(false);
  });

  it("returns true if array is empty and min length is 1", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [],
      union: { field1: "test" },
      nested: {
        nestedField1: "test",
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(issue && persona.isMissingOrNull(issue)).toBe(true);
  });
});

describe("evaluateAccount", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    chainMock.id = optimism.id;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when scope is not supported", async () => {
    await expect(persona.evaluateAccount({ data: [] }, "invalid" as persona.AccountScope)).rejects.toThrow(
      "unhandled account scope: invalid",
    );
  });

  describe("basic", () => {
    it("returns panda template when account not found", async () => {
      const result = await persona.evaluateAccount({ data: [] }, "basic");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns panda template when all fields are missing", async () => {
      const result = await persona.evaluateAccount(emptyAccount, "basic");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns undefined when account exists and is valid", async () => {
      const result = await persona.evaluateAccount(basicAccount, "basic");

      expect(result).toBeUndefined();
    });

    it("throws when account exists but is invalid", async () => {
      await expect(
        persona.evaluateAccount(
          { data: [{ id: "acc-123", type: "account", attributes: { "country-code": 3 } }] },
          "basic",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });
  });

  describe("manteca", () => {
    it("returns panda template when account not found", async () => {
      const result = await persona.evaluateAccount({ data: [] }, "manteca");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns manteca template when account exists and id class is allowed", async () => {
      const result = await persona.evaluateAccount(basicAccount, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("throws when account exists but country is not allowed", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...mantecaAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...mantecaAccount.data[0]?.attributes,
                  "country-code": "XX",
                },
              },
            ],
          },
          "manteca",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.NOT_SUPPORTED);
    });

    it("throws invalid account when country code is empty string", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...basicAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...basicAccount.data[0]?.attributes,
                  "country-code": "",
                },
              },
            ],
          },
          "manteca",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.INVALID_ACCOUNT);
    });

    it("returns panda template when account exists but basic scope is not valid", async () => {
      const result = await persona.evaluateAccount(emptyAccount, "manteca");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns manteca template when new account has a id class that is not allowed", async () => {
      const result = await persona.evaluateAccount(
        {
          data: [
            {
              ...basicAccount.data[0],
              type: "account" as const,
              id: "test-account-id",
              attributes: {
                ...basicAccount.data[0]?.attributes,
                fields: {
                  ...basicAccount.data[0]?.attributes.fields,
                  documents: {
                    value: [
                      {
                        value: {
                          ...basicAccount.data[0]?.attributes.fields.documents.value[0]?.value,
                          id_class: { value: "invalid" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
        "manteca",
      );

      expect(result).toBe(persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
    });

    it("returns manteca template when id document is missing photos", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_123",
              attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(accountWithIdDocument, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
    });

    it("returns manteca template extra fields when id document has both photos", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_123",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                "selfie-photo": null,
                "id-class": "id",
              },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(accountWithIdDocument, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("returns manteca template extra fields when user has only pp document (no getDocument call)", async () => {
      const result = await persona.evaluateAccount(
        {
          data: [
            {
              ...basicAccount.data[0],
              type: "account" as const,
              id: "test-account-id",
              attributes: {
                ...basicAccount.data[0]?.attributes,
                "country-code": "AR",
                fields: {
                  ...basicAccount.data[0]?.attributes.fields,
                  documents: {
                    type: "array",
                    value: [
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "pp" },
                          id_number: { type: "string", value: "AB123456" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_pp_123" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
        "manteca",
      );

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("returns manteca template extra fields when user has id and pp, id has both photos", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_123",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                "selfie-photo": null,
                "id-class": "id",
              },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(accountWithIdAndPpDocuments, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("returns manteca template extra fields when user has id and pp, id missing photos (fallback to pp)", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_123",
              attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(accountWithIdAndPpDocuments, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("returns manteca template extra fields when multiple same-class documents exist and latest is valid", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_id_complete",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                "selfie-photo": null,
                "id-class": "id",
              },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(
        {
          data: [
            {
              ...basicAccount.data[0],
              type: "account" as const,
              id: "test-account-id",
              attributes: {
                ...basicAccount.data[0]?.attributes,
                "country-code": "AR",
                fields: {
                  ...basicAccount.data[0]?.attributes.fields,
                  documents: {
                    type: "array",
                    value: [
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "id" },
                          id_number: { type: "string", value: "11111111" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_id_incomplete" },
                        },
                      },
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "id" },
                          id_number: { type: "string", value: "22222222" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_id_complete" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
        "manteca",
      );

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("returns undefined when account exists and id class is allowed", async () => {
      const result = await persona.evaluateAccount(mantecaAccount, "manteca");

      expect(result).toBeUndefined();
    });

    it("throws when schema validation fails", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...mantecaAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...mantecaAccount.data[0]?.attributes,
                  fields: {
                    ...mantecaAccount.data[0]?.attributes.fields,
                    tin: { type: "string", value: 123 },
                  },
                },
              },
            ],
          },
          "manteca",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });

    it("returns manteca template with id class when user has manteca fields but invalid id document", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_123",
              attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
            },
          },
          { status: 200 },
        ),
      );

      const result = await persona.evaluateAccount(
        {
          data: [
            {
              ...mantecaAccount.data[0],
              type: "account" as const,
              id: "test-account-id",
              attributes: {
                ...mantecaAccount.data[0]?.attributes,
                "country-code": "AR",
                fields: {
                  ...mantecaAccount.data[0]?.attributes.fields,
                  documents: {
                    type: "array",
                    value: [
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "id" },
                          id_number: { type: "string", value: "12345678" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_id_123" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
        "manteca",
      );

      expect(result).toBe(persona.MANTECA_TEMPLATE_WITH_ID_CLASS);
    });
  });

  describe("bridge", () => {
    it("returns panda template when account not found", async () => {
      const result = await persona.evaluateAccount({ data: [] }, "bridge");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns panda template when all fields are missing", async () => {
      const result = await persona.evaluateAccount(emptyAccount, "bridge");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns undefined when account has a supported document", async () => {
      const result = await persona.evaluateAccount(basicAccount, "bridge");

      expect(result).toBeUndefined();
    });

    it("throws not supported when all documents have unsupported id classes", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...basicAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...basicAccount.data[0]?.attributes,
                  fields: {
                    ...basicAccount.data[0]?.attributes.fields,
                    documents: {
                      type: "array",
                      value: [
                        {
                          type: "hash",
                          value: {
                            id_class: { type: "string", value: "wp" },
                            id_number: { type: "string", value: "WP123456" },
                            id_issuing_country: { type: "string", value: "AR" },
                            id_document_id: { type: "string", value: "doc_wp_123" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
          "bridge",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.NOT_SUPPORTED);
    });

    it("throws not supported when newest document is unsupported and no supported documents exist", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...basicAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...basicAccount.data[0]?.attributes,
                  fields: {
                    ...basicAccount.data[0]?.attributes.fields,
                    documents: {
                      type: "array",
                      value: [
                        {
                          type: "hash",
                          value: {
                            id_class: { type: "string", value: "rp" },
                            id_number: { type: "string", value: "RP123456" },
                            id_issuing_country: { type: "string", value: "AR" },
                            id_document_id: { type: "string", value: "doc_rp_123" },
                          },
                        },
                        {
                          type: "hash",
                          value: {
                            id_class: { type: "string", value: "wp" },
                            id_number: { type: "string", value: "WP789012" },
                            id_issuing_country: { type: "string", value: "AR" },
                            id_document_id: { type: "string", value: "doc_wp_456" },
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
          "bridge",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.NOT_SUPPORTED);
    });

    it("returns undefined when supported document exists among unsupported ones", async () => {
      const result = await persona.evaluateAccount(
        {
          data: [
            {
              ...basicAccount.data[0],
              type: "account" as const,
              id: "test-account-id",
              attributes: {
                ...basicAccount.data[0]?.attributes,
                fields: {
                  ...basicAccount.data[0]?.attributes.fields,
                  documents: {
                    type: "array",
                    value: [
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "pp" },
                          id_number: { type: "string", value: "PP123456" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_pp_123" },
                        },
                      },
                      {
                        type: "hash",
                        value: {
                          id_class: { type: "string", value: "wp" },
                          id_number: { type: "string", value: "WP789012" },
                          id_issuing_country: { type: "string", value: "AR" },
                          id_document_id: { type: "string", value: "doc_wp_456" },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
        "bridge",
      );

      expect(result).toBeUndefined();
    });

    it("throws not supported when documents list is empty", async () => {
      await expect(
        persona.evaluateAccount(
          {
            data: [
              {
                ...basicAccount.data[0],
                type: "account" as const,
                id: "test-account-id",
                attributes: {
                  ...basicAccount.data[0]?.attributes,
                  fields: {
                    ...basicAccount.data[0]?.attributes.fields,
                    documents: { type: "array", value: [] },
                  },
                },
              },
            ],
          },
          "bridge",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.NOT_SUPPORTED);
    });

    it("throws when account exists but is invalid", async () => {
      await expect(
        persona.evaluateAccount(
          { data: [{ id: "acc-123", type: "account", attributes: { "country-code": 3 } }] },
          "bridge",
        ),
      ).rejects.toThrow(persona.scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });
  });
});

describe("updateCardLimit", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("patches persona account with card_limit_usd", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "acct_123", type: "account", attributes: { fields: { card_limit_usd: { value: null } } } }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { id: "acct_123" } }));

    await persona.updateCardLimit("ref_123", 20_000);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const patchCall = fetchSpy.mock.calls[1];
    expect(patchCall?.[0]).toContain("/accounts/acct_123");
    expect(patchCall?.[1]).toMatchObject({
      method: "PATCH",
      body: JSON.stringify({ data: { attributes: { fields: { card_limit_usd: 20_000 } } } }),
    });
  });

  it("throws when account not found", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ data: [] }));

    await expect(persona.updateCardLimit("ref_123", 20_000)).rejects.toThrow("account not found");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("sends only card_limit_usd in patch body", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json({
          data: [{ id: "acct_456", type: "account", attributes: { fields: { card_limit_usd: { value: 10_000 } } } }],
        }),
      )
      .mockResolvedValueOnce(Response.json({ data: { id: "acct_456" } }));

    await persona.updateCardLimit("ref_456", 30_000);

    expect(fetchSpy.mock.calls[1]?.[1]).toMatchObject({
      body: JSON.stringify({ data: { attributes: { fields: { card_limit_usd: 30_000 } } } }),
    });
  });
});

describe("getUnknownAccount", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches accounts filtered by reference id and returns parsed result", async () => {
    const account = { id: "acct_123", type: "account" as const, attributes: {} };
    fetchSpy.mockResolvedValueOnce(Response.json({ data: [account] }));

    const result = await persona.getUnknownAccount("ref_123");

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(fetchSpy.mock.calls[0]?.[0]).toContain("/accounts?page[size]=1&filter[reference-id]=ref_123");
    expect(result).toStrictEqual({ data: [account] });
  });
});

describe("getCardLimitStatus", () => {
  let fetchSpy: MockInstance<typeof fetch>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns resolved when card_limit_usd value is set", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json({
        data: [{ id: "acct_123", type: "account", attributes: { fields: { card_limit_usd: { value: 20_000 } } } }],
      }),
    );

    const status = await persona.getCardLimitStatus("ref_123");

    expect(status).toStrictEqual({ status: "resolved" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("reuses preloaded account when card_limit_usd value is set", async () => {
    const status = await persona.getCardLimitStatus("ref_123", {
      data: [{ id: "acct_123", type: "account", attributes: { fields: { card_limit_usd: { value: 20_000 } } } }],
    });

    expect(status).toStrictEqual({ status: "resolved" });
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });

  it("returns noTemplate when basic kyc is not approved", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ data: [] }));

    const status = await persona.getCardLimitStatus("ref_123");

    expect(status).toStrictEqual({ status: "noTemplate" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("returns noInquiry when template matches but inquiry is missing", async () => {
    fetchSpy
      .mockResolvedValueOnce(Response.json(basicAccount))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [] }));

    const status = await persona.getCardLimitStatus("ref_123");

    expect(status).toStrictEqual({ status: "noInquiry" });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("reuses preloaded account and only fetches inquiries when card limit is pending", async () => {
    fetchSpy.mockResolvedValueOnce(Response.json({ data: [] })).mockResolvedValueOnce(Response.json({ data: [] }));

    const status = await persona.getCardLimitStatus("ref_123", basicAccount);

    expect(status).toStrictEqual({ status: "noInquiry" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns inquiry with status when inquiry exists", async () => {
    const inquiry = {
      id: "inq_1",
      type: "inquiry",
      attributes: { status: "pending", "reference-id": "ref_123" },
    };
    fetchSpy
      .mockResolvedValueOnce(Response.json(basicAccount))
      .mockResolvedValueOnce(Response.json({ data: [] }))
      .mockResolvedValueOnce(Response.json({ data: [inquiry] }));

    const status = await persona.getCardLimitStatus("ref_123");

    expect(status).toStrictEqual({ status: "pending", id: inquiry.id });
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("captures and rethrows exception when fetch rejects", async () => {
    const error = new Error("network error");
    fetchSpy.mockRejectedValueOnce(error);

    await expect(persona.getCardLimitStatus("ref_123")).rejects.toThrow("network error");
    expect(captureException).toHaveBeenCalledWith(error, {
      level: "error",
      contexts: { details: { referenceId: "ref_123", scope: "cardLimit" } },
    });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("evaluateAccount cardLimit", () => {
  it("returns panda template when basic is not done", async () => {
    const result = await persona.evaluateAccount(emptyAccount, "cardLimit");

    expect(result).toBe(persona.PANDA_TEMPLATE);
  });

  it("returns card limit template when basic is done", async () => {
    const result = await persona.evaluateAccount(basicAccount, "cardLimit");

    expect(result).toBe(persona.CARD_LIMIT_TEMPLATE);
  });
});

describe("getDocumentForBridge", () => {
  it("returns undefined for empty documents", () => {
    expect(persona.getDocumentForBridge([])).toBeUndefined();
  });

  it("returns supported document value", () => {
    const document = {
      id_class: { value: "pp" },
      id_number: { value: "PP123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_123" },
    };
    expect(persona.getDocumentForBridge([{ value: document }])).toBe(document);
  });

  it("returns undefined when all documents have unsupported id classes", () => {
    const wpDocument = {
      id_class: { value: "wp" },
      id_number: { value: "WP123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_wp_123" },
    };
    const rpDocument = {
      id_class: { value: "rp" },
      id_number: { value: "RP123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_rp_123" },
    };
    expect(persona.getDocumentForBridge([{ value: wpDocument }, { value: rpDocument }])).toBeUndefined();
  });

  it("returns the last supported document, ignoring unsupported ones", () => {
    const ppDocument = {
      id_class: { value: "pp" },
      id_number: { value: "PP123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_123" },
    };
    const wpDocument = {
      id_class: { value: "wp" },
      id_number: { value: "WP789012" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_wp_456" },
    };
    expect(persona.getDocumentForBridge([{ value: ppDocument }, { value: wpDocument }])).toBe(ppDocument);
  });

  it("returns the last supported document when multiple supported documents exist", () => {
    const dlDocument = {
      id_class: { value: "dl" },
      id_number: { value: "DL123456" },
      id_issuing_country: { value: "US" },
      id_document_id: { value: "doc_dl_123" },
    };
    const ppDocument = {
      id_class: { value: "pp" },
      id_number: { value: "PP123456" },
      id_issuing_country: { value: "US" },
      id_document_id: { value: "doc_pp_123" },
    };
    expect(persona.getDocumentForBridge([{ value: dlDocument }, { value: ppDocument }])).toBe(ppDocument);
  });
});

describe("getAllowedMantecaIds", () => {
  describe("development mode", () => {
    beforeEach(() => {
      chainMock.id = baseSepolia.id;
    });

    it("returns allowed ids for supported countries (AR)", () => {
      const result = persona.getAllowedMantecaIds("AR");

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual({ id: "id", side: "both" });
      expect(result?.[1]).toEqual({ id: "pp", side: "front" });
    });

    it("returns allowed ids for supported countries (BR)", () => {
      const result = persona.getAllowedMantecaIds("BR");

      expect(result).toBeDefined();
      expect(result).toHaveLength(3);
      expect(result?.[0]).toEqual({ id: "dl", side: "both" });
      expect(result?.[1]).toEqual({ id: "pp", side: "front" });
      expect(result?.[2]).toEqual({ id: "id", side: "both" });
    });

    it("returns dl fallback for US in development mode", () => {
      const result = persona.getAllowedMantecaIds("US");

      expect(result).toBeDefined();
      expect(result).toHaveLength(1);
      expect(result?.[0]).toEqual({ id: "dl", side: "front" });
    });

    it("returns undefined for unsupported countries", () => {
      const result = persona.getAllowedMantecaIds("XX");

      expect(result).toBeUndefined();
    });
  });

  describe("retrieving allowed ids", () => {
    beforeEach(() => {
      chainMock.id = optimism.id;
    });

    it("returns allowed ids for supported countries (AR)", () => {
      const result = persona.getAllowedMantecaIds("AR");

      expect(result).toBeDefined();
      expect(result).toHaveLength(2);
      expect(result?.[0]).toEqual({ id: "id", side: "both" });
      expect(result?.[1]).toEqual({ id: "pp", side: "front" });
    });

    it("returns allowed ids for supported countries (BR)", () => {
      const result = persona.getAllowedMantecaIds("BR");

      expect(result).toBeDefined();
      expect(result).toHaveLength(3);
      expect(result?.[0]).toEqual({ id: "dl", side: "both" });
    });

    it("returns undefined for US in production mode (no fallback)", () => {
      const result = persona.getAllowedMantecaIds("US");

      expect(result).toBeUndefined();
    });

    it("returns undefined for invalid country code", () => {
      const result = persona.getAllowedMantecaIds("XX");

      expect(result).toBeUndefined();
    });

    it("returns undefined for country not listed", () => {
      const result = persona.getAllowedMantecaIds("INVALID");

      expect(result).toBeUndefined();
    });
  });
});

describe("get document for manteca", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    chainMock.id = optimism.id;
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns undefined when no document is found", async () => {
    const result = await persona.getDocumentForManteca([], "US");

    expect(result).toBeUndefined();
  });

  it("returns undefined when id class is not allowed", async () => {
    const document = {
      id_class: { value: "dl" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "1234567890" },
    };
    const result = await persona.getDocumentForManteca([{ value: document }], "AR");

    expect(result).toBeUndefined();
  });

  it("returns undefined when country is not supported (allowedIds is undefined)", async () => {
    const document = {
      id_class: { value: "id" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "XX" },
      id_document_id: { value: "doc_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: document }], "XX");

    expect(result).toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns pp document without fetching (no photo check required)", async () => {
    const document = {
      id_class: { value: "pp" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: document }], "AR");

    expect(result).toBe(document);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns id document when it has both photos", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          data: {
            id: "doc_123",
            attributes: {
              "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
              "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
              "selfie-photo": null,
              "id-class": "id",
            },
          },
        },
        { status: 200 },
      ),
    );

    const document = {
      id_class: { value: "id" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: document }], "AR");

    expect(result).toBe(document);
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("returns undefined when id document is missing photos and no fallback", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          data: {
            id: "doc_123",
            attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
          },
        },
        { status: 200 },
      ),
    );

    const document = {
      id_class: { value: "id" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: document }], "AR");

    expect(result).toBeUndefined();
  });

  it("returns latest document when multiple documents of same class exist and latest has both photos", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          data: {
            id: "doc_id_latest",
            attributes: {
              "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
              "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
              "selfie-photo": null,
              "id-class": "id",
            },
          },
        },
        { status: 200 },
      ),
    );

    const earlierDocument = {
      id_class: { value: "id" },
      id_number: { value: "11111111" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_earlier" },
    };
    const latestDocument = {
      id_class: { value: "id" },
      id_number: { value: "22222222" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_latest" },
    };
    const result = await persona.getDocumentForManteca([{ value: earlierDocument }, { value: latestDocument }], "AR");

    expect(result).toBe(latestDocument);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("falls back to earlier document when latest same-class document is missing photos", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_id_latest",
              attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
            },
          },
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_id_earlier",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                "selfie-photo": null,
                "id-class": "id",
              },
            },
          },
          { status: 200 },
        ),
      );

    const earlierDocument = {
      id_class: { value: "id" },
      id_number: { value: "11111111" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_earlier" },
    };
    const latestDocument = {
      id_class: { value: "id" },
      id_number: { value: "22222222" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_latest" },
    };
    const result = await persona.getDocumentForManteca([{ value: earlierDocument }, { value: latestDocument }], "AR");

    expect(result).toBe(earlierDocument);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("returns latest pp document when multiple pp documents exist (front-only, no fetch)", async () => {
    const olderPp = {
      id_class: { value: "pp" },
      id_number: { value: "OLD111" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_old" },
    };
    const newerPp = {
      id_class: { value: "pp" },
      id_number: { value: "NEW222" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_new" },
    };
    const result = await persona.getDocumentForManteca([{ value: olderPp }, { value: newerPp }], "AR");

    expect(result).toBe(newerPp);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns id document when it has both photos (priority over pp)", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          data: {
            id: "doc_123",
            attributes: {
              "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
              "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
              "selfie-photo": null,
              "id-class": "id",
            },
          },
        },
        { status: 200 },
      ),
    );

    const idDocument = {
      id_class: { value: "id" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_123" },
    };
    const ppDocument = {
      id_class: { value: "pp" },
      id_number: { value: "AB123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: ppDocument }, { value: idDocument }], "AR");

    expect(result).toBe(idDocument);
  });

  it("falls back to pp when id document is missing photos", async () => {
    fetchSpy.mockResolvedValueOnce(
      Response.json(
        {
          data: {
            id: "doc_123",
            attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
          },
        },
        { status: 200 },
      ),
    );

    const idDocument = {
      id_class: { value: "id" },
      id_number: { value: "1234567890" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_123" },
    };
    const ppDocument = {
      id_class: { value: "pp" },
      id_number: { value: "AB123456" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_pp_123" },
    };
    const result = await persona.getDocumentForManteca([{ value: ppDocument }, { value: idDocument }], "AR");

    expect(result).toBe(ppDocument);
  });

  describe("brazil priority order: dl > pp > id", () => {
    it("prioritizes dl over pp and id when dl has both photos", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_dl_123",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                "selfie-photo": null,
                "id-class": "dl",
              },
            },
          },
          { status: 200 },
        ),
      );

      const dlDocument = {
        id_class: { value: "dl" },
        id_number: { value: "DL123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_dl_123" },
      };
      const ppDocument = {
        id_class: { value: "pp" },
        id_number: { value: "PP123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_pp_123" },
      };
      const idDocument = {
        id_class: { value: "id" },
        id_number: { value: "ID123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_id_123" },
      };

      const result = await persona.getDocumentForManteca(
        [{ value: idDocument }, { value: ppDocument }, { value: dlDocument }],
        "BR",
      );

      expect(result).toBe(dlDocument);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("falls back to pp when dl is missing back photo", async () => {
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_dl_123",
              attributes: {
                "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                "back-photo": null,
                "selfie-photo": null,
                "id-class": "dl",
              },
            },
          },
          { status: 200 },
        ),
      );

      const dlDocument = {
        id_class: { value: "dl" },
        id_number: { value: "DL123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_dl_123" },
      };
      const ppDocument = {
        id_class: { value: "pp" },
        id_number: { value: "PP123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_pp_123" },
      };

      const result = await persona.getDocumentForManteca([{ value: dlDocument }, { value: ppDocument }], "BR");

      expect(result).toBe(ppDocument);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it("falls back to id when dl missing photos and no pp present", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          Response.json(
            {
              data: {
                id: "doc_dl_123",
                attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "dl" },
              },
            },
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              data: {
                id: "doc_id_123",
                attributes: {
                  "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                  "back-photo": { filename: "back.jpg", url: "https://example.com/back.jpg" },
                  "selfie-photo": null,
                  "id-class": "id",
                },
              },
            },
            { status: 200 },
          ),
        );

      const dlDocument = {
        id_class: { value: "dl" },
        id_number: { value: "DL123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_dl_123" },
      };
      const idDocument = {
        id_class: { value: "id" },
        id_number: { value: "ID123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_id_123" },
      };

      const result = await persona.getDocumentForManteca([{ value: dlDocument }, { value: idDocument }], "BR");

      expect(result).toBe(idDocument);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns undefined when dl and id both missing photos and no pp", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          Response.json(
            {
              data: {
                id: "doc_dl_123",
                attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "dl" },
              },
            },
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
          Response.json(
            {
              data: {
                id: "doc_id_123",
                attributes: { "front-photo": null, "back-photo": null, "selfie-photo": null, "id-class": "id" },
              },
            },
            { status: 200 },
          ),
        );

      const dlDocument = {
        id_class: { value: "dl" },
        id_number: { value: "DL123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_dl_123" },
      };
      const idDocument = {
        id_class: { value: "id" },
        id_number: { value: "ID123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_id_123" },
      };

      const result = await persona.getDocumentForManteca([{ value: dlDocument }, { value: idDocument }], "BR");

      expect(result).toBeUndefined();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it("returns pp without photo check (side: front)", async () => {
      const ppDocument = {
        id_class: { value: "pp" },
        id_number: { value: "PP123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_pp_123" },
      };

      const result = await persona.getDocumentForManteca([{ value: ppDocument }], "BR");

      expect(result).toBe(ppDocument);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("skips dl check and returns pp when only pp is present", async () => {
      const ppDocument = {
        id_class: { value: "pp" },
        id_number: { value: "PP123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_pp_123" },
      };
      const idDocument = {
        id_class: { value: "id" },
        id_number: { value: "ID123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_id_123" },
      };

      const result = await persona.getDocumentForManteca([{ value: ppDocument }, { value: idDocument }], "BR");

      expect(result).toBe(ppDocument);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("returns pp even when actual document has null back photo (side: front)", async () => {
      const ppDocument = {
        id_class: { value: "pp" },
        id_number: { value: "PP123456" },
        id_issuing_country: { value: "BR" },
        id_document_id: { value: "doc_pp_123" },
      };
      const result = await persona.getDocumentForManteca([{ value: ppDocument }], "BR");

      expect(result).toBe(ppDocument);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });
});

const emptyAccount = {
  data: [
    {
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
                value: null,
              },
              middle: {
                type: "string",
                value: null,
              },
              last: {
                type: "string",
                value: null,
              },
            },
          },
          address: {
            type: "hash",
            value: {
              street_1: {
                type: "string",
                value: null,
              },
              street_2: {
                type: "string",
                value: null,
              },
              city: {
                type: "string",
                value: null,
              },
              subdivision: {
                type: "string",
                value: null,
              },
              postal_code: {
                type: "string",
                value: null,
              },
              country_code: {
                type: "string",
                value: null,
              },
            },
          },
          identification_numbers: {
            type: "array",
            value: [],
          },
          birthdate: {
            type: "date",
            value: null,
          },
          phone_number: {
            type: "string",
            value: null,
          },
          email_address: {
            type: "string",
            value: null,
          },
          selfie_photo: {
            type: "file",
            value: null,
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
          sex: {
            type: "choices",
            value: null,
          },
          manteca_t_c: {
            type: "boolean",
            value: null,
          },
          rain_e_sign_consent: {
            type: "boolean",
            value: null,
          },
          exa_card_tc: {
            type: "boolean",
            value: null,
          },
          privacy__policy: {
            type: "boolean",
            value: null,
          },
          sex_1: {
            type: "string",
            value: null,
          },
          account_opening_disclosure: {
            type: "boolean",
            value: null,
          },
          documents: {
            type: "array",
            value: [],
          },
        },
        "name-first": null,
        "name-middle": null,
        "name-last": null,
        "social-security-number": null,
        "address-street-1": null,
        "address-street-2": null,
        "address-city": null,
        "address-subdivision": null,
        "address-postal-code": null,
        "country-code": null,
        birthdate: null,
        "phone-number": null,
        "email-address": null,
        tags: [],
        "account-status": "Default",
        "identification-numbers": {},
      },
      relationships: {
        "account-type": {
          data: {
            type: "account-type",
            id: "account-type-id",
          },
        },
      },
    },
  ],
};

const basicAccount = {
  data: [
    {
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
                value: "AR",
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
                    value: "pp",
                  },
                  identification_number: {
                    type: "string",
                    value: "AB123456",
                  },
                  issuing_country: {
                    type: "string",
                    value: "AR",
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
                    value: "pp",
                  },
                  id_number: {
                    type: "string",
                    value: "AB123456",
                  },
                  id_issuing_country: {
                    type: "string",
                    value: "AR",
                  },
                  id_document_id: {
                    type: "string",
                    value: "doc_pp_123",
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
          pp: [
            {
              "issuing-country": "AR",
              "identification-class": "pp",
              "identification-number": "AB123456",
              "created-at": "2025-12-11T00:00:00.000Z",
              "updated-at": "2025-12-11T00:00:00.000Z",
            },
          ],
        },
      },
    },
  ],
};

const mantecaAccount = {
  data: [
    {
      ...basicAccount.data[0],
      type: "account" as const,
      id: "test-account-id",
      attributes: {
        ...basicAccount.data[0]?.attributes,
        fields: {
          ...basicAccount.data[0]?.attributes.fields,
          tin: {
            type: "string",
            value: "12345678",
          },
          manteca_t_c: {
            type: "boolean",
            value: true,
          },
          sex_1: {
            type: "string",
            value: "Male",
          },
          isnotfacta: {
            type: "boolean",
            value: true,
          },
        },
      },
    },
  ],
};

const accountWithIdDocument = {
  data: [
    {
      ...basicAccount.data[0],
      type: "account" as const,
      id: "test-account-id",
      attributes: {
        ...basicAccount.data[0]?.attributes,
        "country-code": "AR",
        fields: {
          ...basicAccount.data[0]?.attributes.fields,
          documents: {
            type: "array",
            value: [
              {
                type: "hash",
                value: {
                  id_class: { type: "string", value: "id" },
                  id_number: { type: "string", value: "12345678" },
                  id_issuing_country: { type: "string", value: "AR" },
                  id_document_id: { type: "string", value: "doc_id_123" },
                },
              },
            ],
          },
        },
      },
    },
  ],
};

describe("parseAccount", () => {
  it("returns the first account when basic scope matches", () => {
    const result = persona.parseAccount(basicAccount, "basic");
    expect(result?.id).toBe("test-account-id");
    expect(result?.attributes["country-code"]).toBeDefined();
  });

  it("returns undefined when basic scope does not match", () => {
    expect(persona.parseAccount({ data: [{ id: "x", type: "account", attributes: {} }] }, "basic")).toBeUndefined();
  });

  it("returns undefined when data array is empty", () => {
    expect(persona.parseAccount({ data: [] }, "basic")).toBeUndefined();
    expect(persona.parseAccount({ data: [] }, "cardLimit")).toBeUndefined();
  });

  it("returns the first account when cardLimit scope matches", () => {
    const account = {
      data: [{ id: "cl-id", type: "account" as const, attributes: { fields: { card_limit_usd: { value: 5000 } } } }],
    };
    const result = persona.parseAccount(account, "cardLimit");
    expect(result?.id).toBe("cl-id");
    expect(result?.attributes.fields.card_limit_usd?.value).toBe(5000);
  });

  it("returns undefined when cardLimit scope does not match", () => {
    expect(persona.parseAccount({ data: [{ id: "x", type: "account", attributes: {} }] }, "cardLimit")).toBeUndefined();
  });
});

const accountWithIdAndPpDocuments = {
  data: [
    {
      ...basicAccount.data[0],
      type: "account" as const,
      id: "test-account-id",
      attributes: {
        ...basicAccount.data[0]?.attributes,
        "country-code": "AR",
        fields: {
          ...basicAccount.data[0]?.attributes.fields,
          documents: {
            type: "array",
            value: [
              {
                type: "hash",
                value: {
                  id_class: { type: "string", value: "id" },
                  id_number: { type: "string", value: "12345678" },
                  id_issuing_country: { type: "string", value: "AR" },
                  id_document_id: { type: "string", value: "doc_id_123" },
                },
              },
              {
                type: "hash",
                value: {
                  id_class: { type: "string", value: "pp" },
                  id_number: { type: "string", value: "AB123456" },
                  id_issuing_country: { type: "string", value: "AR" },
                  id_document_id: { type: "string", value: "doc_pp_123" },
                },
              },
            ],
          },
        },
      },
    },
  ],
};
