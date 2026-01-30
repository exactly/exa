import "../mocks/persona";
import "../mocks/sentry";

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

    it("returns manteca template extra fields when multiple same-class documents exist and only one is valid", async () => {
      fetchSpy
        .mockResolvedValueOnce(
          Response.json(
            {
              data: {
                id: "doc_id_incomplete",
                attributes: {
                  "front-photo": { filename: "front.jpg", url: "https://example.com/front.jpg" },
                  "back-photo": null,
                  "selfie-photo": null,
                  "id-class": "id",
                },
              },
            },
            { status: 200 },
          ),
        )
        .mockResolvedValueOnce(
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
      expect(fetchSpy).toHaveBeenCalledTimes(2);
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

  it("returns document with both photos when multiple documents of same class exist", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        Response.json(
          {
            data: {
              id: "doc_id_incomplete",
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

    const incompleteDocument = {
      id_class: { value: "id" },
      id_number: { value: "11111111" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_incomplete" },
    };
    const completeDocument = {
      id_class: { value: "id" },
      id_number: { value: "22222222" },
      id_issuing_country: { value: "AR" },
      id_document_id: { value: "doc_id_complete" },
    };
    const result = await persona.getDocumentForManteca(
      [{ value: incompleteDocument }, { value: completeDocument }],
      "AR",
    );

    expect(result).toBe(completeDocument);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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
