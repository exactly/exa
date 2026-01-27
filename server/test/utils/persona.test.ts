import "../mocks/persona";
import "../mocks/sentry";

import { array, minLength, number, object, optional, pipe, safeParse, string, union } from "valibot";
import { describe, expect, it, vi } from "vitest";

import * as persona from "../../utils/persona";

vi.mock("../../utils/panda");
vi.mock("../../utils/pax");
vi.mock("@sentry/node", { spy: true });

function getFirst<T>(items: T[]): T {
  if (items.length !== 1) throw new Error("expected exactly one element");
  return items[0] as T;
}

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
  it("throws when scope is not supported", () => {
    expect(() =>
      persona.evaluateAccount({ data: [], links: { next: null } }, "invalid" as persona.AccountScope),
    ).toThrow("unhandled account scope: invalid");
  });

  describe("basic", () => {
    it("returns panda template when account not found", () => {
      const result = persona.evaluateAccount({ data: [], links: { next: null } }, "basic");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns panda template when all fields are missing", () => {
      const result = persona.evaluateAccount(emptyAccount, "basic");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns undefined when account exists and is valid", () => {
      const result = persona.evaluateAccount(basicAccount, "basic");

      expect(result).toBeUndefined();
    });

    it("throws when account exists but is invalid", () => {
      expect(() =>
        persona.evaluateAccount(
          {
            data: [{ id: "acc-123", attributes: { "reference-id": null, "country-code": 3 } }],
            links: { next: null },
          },
          "basic",
        ),
      ).toThrow(persona.scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });
  });

  describe("manteca", () => {
    it("returns panda template when account not found", () => {
      const result = persona.evaluateAccount({ data: [], links: { next: null } }, "manteca");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns manteca template when account exists and id class is allowed", () => {
      const result = persona.evaluateAccount(basicAccount, "manteca");

      expect(result).toBe(persona.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("throws when account exists but country is not allowed", () => {
      expect(() =>
        persona.evaluateAccount(
          {
            links: { next: null },
            data: [
              {
                ...getFirst(mantecaAccount.data),
                id: "test-account-id",
                attributes: {
                  ...getFirst(mantecaAccount.data).attributes,
                  "country-code": "XX",
                },
              },
            ],
          },
          "manteca",
        ),
      ).toThrow(persona.scopeValidationErrors.NOT_SUPPORTED);
    });

    it("returns panda template when account exists but basic scope is not valid", () => {
      const result = persona.evaluateAccount(emptyAccount, "manteca");

      expect(result).toBe(persona.PANDA_TEMPLATE);
    });

    it("returns manteca template when new account has a id class that is not allowed", () => {
      const basic = getFirst(basicAccount.data);
      const document = getFirst(basic.attributes.fields.documents.value);
      const result = persona.evaluateAccount(
        {
          links: { next: null },
          data: [
            {
              ...basic,
              id: "test-account-id",
              attributes: {
                ...basic.attributes,
                fields: {
                  ...basic.attributes.fields,
                  documents: {
                    value: [
                      {
                        value: {
                          ...document.value,
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

    it("returns undefined when account exists and id class is allowed", () => {
      const result = persona.evaluateAccount(mantecaAccount, "manteca");

      expect(result).toBeUndefined();
    });

    it("throws when schema validation fails", () => {
      const manteca = getFirst(mantecaAccount.data);
      expect(() =>
        persona.evaluateAccount(
          {
            links: { next: null },
            data: [
              {
                ...manteca,
                id: "test-account-id",
                attributes: {
                  ...manteca.attributes,
                  fields: {
                    ...manteca.attributes.fields,
                    tin: { type: "string", value: 123 },
                  },
                },
              },
            ],
          },
          "manteca",
        ),
      ).toThrow(persona.scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });
  });
});

const emptyAccount = {
  links: { next: null },
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
  links: { next: null },
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

const basicData = getFirst(basicAccount.data);

const mantecaAccount = {
  links: { next: null },
  data: [
    {
      ...basicData,
      type: "account" as const,
      id: "test-account-id",
      attributes: {
        ...basicData.attributes,
        fields: {
          ...basicData.attributes.fields,
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
