import "../mocks/sentry";

import { array, number, object, optional, safeParse, string, union } from "valibot";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPendingInquiryTemplate,
  isMissingOrNull,
  MANTECA_TEMPLATE_EXTRA_FIELDS,
  MANTECA_TEMPLATE_WITH_ID_CLASS,
  PANDA_TEMPLATE,
  scopeValidationErrors,
  type AccountScope,
} from "../../utils/persona";

const mockFetch = vi.spyOn(global, "fetch");

describe("is missing or null util", () => {
  const schema = object({
    field1: string(),
    field2: optional(string()),
    array: array(
      object({
        arrayField1: string(),
        arrayField2: optional(string()),
      }),
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
    expect(issue && isMissingOrNull(issue)).toBe(true);
  });

  it("returns false if field is not valid", () => {
    const result = safeParse(schema, {
      field1: 123,
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
    expect(issue && isMissingOrNull(issue)).toBe(false);
  });

  it("returns true if nested field is null or undefined", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [],
      union: { field1: "test" },
      nested: {
        nestedField1: null,
        nestedArray: [],
      },
    });
    const issue = result.issues?.[0];

    expect(result.success).toBe(false);
    expect(result.issues?.length).toBe(1);
    expect(issue && isMissingOrNull(issue)).toBe(true);
  });

  it("returns true if union is null or undefined", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [],
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
    expect(issue && isMissingOrNull(issue)).toBe(true);
  });

  it("returns true if union is defined but all sub issues are undefined or null", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [],
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
    expect(issue && isMissingOrNull(issue)).toBe(true);
  });

  it("returns false if union is defined and at least one sub issue is not undefined or null", () => {
    const result = safeParse(schema, {
      field1: "test",
      array: [],
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
    expect(issue && isMissingOrNull(issue)).toBe(false);
  });
});

describe("evaluate scope", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("throws when scope is not supported", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

    await expect(getPendingInquiryTemplate("reference-id", "invalid" as AccountScope)).rejects.toThrow(
      `unhandled account scope: invalid`,
    );
  });

  describe("basic", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("returns panda template when all fields are missing", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(emptyAccount) } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("returns undefined when account exists and is valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(basicAccount),
      } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBeUndefined();
    });

    it("throws when account exists but is invalid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "acc-123", type: "account", attributes: { "country-code": 3 } }] }),
      } as Response);

      await expect(getPendingInquiryTemplate("reference-id", "basic")).rejects.toThrow(
        scopeValidationErrors.INVALID_SCOPE_VALIDATION,
      );
    });
  });

  describe("manteca", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "manteca");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("returns manteca template when account exists and id class is allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(basicAccount),
      } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("throws when account exists but country is not allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                ...basicAccount.data[0],
                attributes: {
                  ...basicAccount.data[0]?.attributes,
                  "country-code": "XX",
                },
              },
            ],
          }),
      } as Response);

      await expect(getPendingInquiryTemplate("reference-id", "manteca")).rejects.toThrow(
        scopeValidationErrors.NOT_SUPPORTED,
      );
    });

    it("returns panda template when account exists but basic scope is not valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyAccount),
      } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("returns manteca template when id class is not allowed", async () => {
      // TODO update test when we have a real account
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "acc-123",
                type: "account",
                attributes: {
                  "country-code": "AR",
                  fields: {},
                },
              },
            ],
          }),
      } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(MANTECA_TEMPLATE_WITH_ID_CLASS);
    });

    it("returns undefined when account exists and id class is allowed", async () => {
      // TODO update test when we have a real account
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "acc-123",
                type: "account",
                attributes: {
                  "country-code": "US",
                  fields: {
                    isnotfacta: { type: "boolean", value: true }, // cspell:ignore isnotfacta
                    tin: { type: "string", value: "12345678" },
                    sex_1: { type: "string", value: "Male" },
                    manteca_t_c: { type: "boolean", value: true },
                  },
                },
              },
            ],
          }),
      } as Response);

      const result = await getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBeUndefined();
    });

    it("throws when schema validation fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "acc-123",
                type: "account",
                attributes: {
                  "country-code": "US",
                  fields: {
                    isnotfacta: { type: "boolean", value: "invalid" }, // cspell:ignore isnotfacta
                    tin: { type: "string", value: "12345678" },
                    sex_1: { type: "string", value: "Male" },
                    manteca_t_c: { type: "boolean", value: true },
                  },
                },
              },
            ],
          }),
      } as Response);

      await expect(getPendingInquiryTemplate("reference-id", "manteca")).rejects.toThrow(
        scopeValidationErrors.INVALID_SCOPE_VALIDATION,
      );
    });
  });
});

const emptyAccount = {
  data: [
    {
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
        "country-code": "US",
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
    },
  ],
};
