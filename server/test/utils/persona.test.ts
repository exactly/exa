import "../mocks/database";
import "../mocks/persona";
import "../mocks/sentry";

import deriveAddress from "@exactly/common/deriveAddress";
import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { array, minLength, number, object, optional, pipe, safeParse, string, union } from "valibot";
import { padHex, zeroAddress, zeroHash } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import database, { credentials } from "../../database";
import app from "../../hooks/persona";
import * as panda from "../../utils/panda";
import { createUser } from "../../utils/panda";
import { addCapita, deriveAssociateId } from "../../utils/pax";
import * as PersonaUtils from "../../utils/persona";
import * as sardine from "../../utils/sardine";

vi.mock("../../utils/panda");
vi.mock("../../utils/pax");
vi.mock("@sentry/node", { spy: true });

const mockFetch = vi.spyOn(global, "fetch");

const { mockNoOpMiddleware } = vi.hoisted(() => {
  return {
    mockNoOpMiddleware: (_c: unknown, next: () => Promise<void>) => next(),
  };
});

vi.mock("../../utils/persona", async (importOriginal) => {
  const actual = await importOriginal<typeof PersonaUtils>();
  return {
    ...actual,
    headerValidator: () => mockNoOpMiddleware,
  };
});

const appClient = testClient(app);

describe("with reference", () => {
  const bob = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database
      .insert(credentials)
      .values([{ id: account, publicKey: new Uint8Array(), account, factory: zeroAddress }]);
  });

  afterEach(() => vi.resetAllMocks());

  it("creates a panda account", async () => {
    const id = privateKeyToAddress(generatePrivateKey());
    vi.mocked(addCapita).mockResolvedValue({});
    await database.insert(credentials).values({
      id,
      publicKey: new Uint8Array(),
      account: id,
      factory: zeroAddress,
      pandaId: null,
    });
    vi.spyOn(panda, "createUser").mockResolvedValueOnce({ id });
    vi.spyOn(sardine, "customer").mockResolvedValueOnce({
      sessionKey: "test-session-123",
      status: "Success",
      level: "low",
    });
    const response = await appClient.index.$post({
      ...personaPayload,
      json: {
        ...personaPayload.json,
        data: {
          ...personaPayload.json.data,
          attributes: {
            ...personaPayload.json.data.attributes,
            payload: {
              ...personaPayload.json.data.attributes.payload,
              data: {
                ...personaPayload.json.data.attributes.payload.data,
                attributes: {
                  ...personaPayload.json.data.attributes.payload.data.attributes,
                  referenceId: id,
                },
              },
              included: [...personaPayload.json.data.attributes.payload.included],
            },
          },
        },
      },
    });
    const p = await database.query.credentials.findFirst({
      where: eq(credentials.id, id),
      columns: { pandaId: true },
    });

    expect(p?.pandaId).toBe(id);

    expect(response.status).toBe(200);
  });

  it("returns 200 if already created", async () => {
    const createdAccount = "already-created";
    await database.insert(credentials).values({
      id: createdAccount,
      publicKey: new Uint8Array(),
      account: createdAccount,
      factory: zeroAddress,
      pandaId: "test-id",
    });

    const response = await appClient.index.$post({
      ...personaPayload,
      json: {
        ...personaPayload.json,
        data: {
          ...personaPayload.json.data,
          attributes: {
            ...personaPayload.json.data.attributes,
            payload: {
              ...personaPayload.json.data.attributes.payload,
              data: {
                ...personaPayload.json.data.attributes.payload.data,
                attributes: {
                  ...personaPayload.json.data.attributes.payload.data.attributes,
                  referenceId: createdAccount,
                },
              },
              included: [...personaPayload.json.data.attributes.payload.included],
            },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(panda.createUser).not.toHaveBeenCalled();
  });

  it("returns 200 if no credential", async () => {
    vi.spyOn(database.query.credentials, "findFirst").mockResolvedValue(undefined); // eslint-disable-line unicorn/no-useless-undefined

    const response = await appClient.index.$post({
      ...personaPayload,
      json: {
        ...personaPayload.json,
        data: {
          ...personaPayload.json.data,
          attributes: {
            ...personaPayload.json.data.attributes,
            payload: {
              ...personaPayload.json.data.attributes.payload,
              data: {
                ...personaPayload.json.data.attributes.payload.data,
                attributes: {
                  ...personaPayload.json.data.attributes.payload.data.attributes,
                  referenceId: account,
                },
              },
              included: [...personaPayload.json.data.attributes.payload.included],
            },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(captureException).toHaveBeenCalledOnce();
    expect(captureException).toHaveBeenCalledWith(
      expect.objectContaining({ message: "no credential" }),
      expect.anything(),
    );
    expect(panda.createUser).not.toHaveBeenCalled();
  });

  describe("handles invalid payload", () => {
    it("returns 200 if no inquiry session", async () => {
      const response = await appClient.index.$post({
        ...personaPayload,
        json: {
          ...personaPayload.json,
          data: {
            ...personaPayload.json.data,
            attributes: {
              ...personaPayload.json.data.attributes,
              payload: {
                ...personaPayload.json.data.attributes.payload,
                included: personaPayload.json.data.attributes.payload.included.filter(
                  (session) => session.type !== "inquiry-session",
                ),
              },
            },
          },
        },
      });

      expect(captureException).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bad persona" }),
        expect.anything(),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        code: "bad persona",
        legacy: "bad persona",
        message: ["data/attributes/payload/included Invalid length: Expected >=1 but received 0"],
      });
      expect(panda.createUser).not.toHaveBeenCalled();
    });

    it("returns 200 if no value for annual-salary or annual-salary-ranges-us-150000", async () => {
      const response = await appClient.index.$post({
        ...personaPayload,
        json: {
          ...personaPayload.json,
          data: {
            ...personaPayload.json.data,
            attributes: {
              ...personaPayload.json.data.attributes,
              payload: {
                ...personaPayload.json.data.attributes.payload,
                data: {
                  ...personaPayload.json.data.attributes.payload.data,
                  attributes: {
                    ...personaPayload.json.data.attributes.payload.data.attributes,
                    fields: {
                      ...personaPayload.json.data.attributes.payload.data.attributes.fields,
                      annualSalary: { value: null },
                      annualSalaryRangesUs150000: undefined,
                    },
                  },
                },
                included: [...personaPayload.json.data.attributes.payload.included],
              },
            },
          },
        },
      });

      expect(captureException).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bad persona" }),
        expect.anything(),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        code: "bad persona",
        legacy: "bad persona",
        message: [
          "data/attributes/payload/data/attributes/fields Either annualSalary or annualSalaryRangesUs150000 must have a value",
        ],
      });
      expect(panda.createUser).not.toHaveBeenCalled();
    });

    it("returns 200 if no value for monthly-purchases-range or expected-monthly-volume", async () => {
      const response = await appClient.index.$post({
        ...personaPayload,
        json: {
          ...personaPayload.json,
          data: {
            ...personaPayload.json.data,
            attributes: {
              ...personaPayload.json.data.attributes,
              payload: {
                ...personaPayload.json.data.attributes.payload,
                data: {
                  ...personaPayload.json.data.attributes.payload.data,
                  attributes: {
                    ...personaPayload.json.data.attributes.payload.data.attributes,
                    fields: {
                      ...personaPayload.json.data.attributes.payload.data.attributes.fields,
                      monthlyPurchasesRange: undefined,
                      expectedMonthlyVolume: { value: null },
                    },
                  },
                },
                included: [...personaPayload.json.data.attributes.payload.included],
              },
            },
          },
        },
      });

      expect(captureException).toHaveBeenCalledOnce();
      expect(captureException).toHaveBeenCalledWith(
        expect.objectContaining({ message: "bad persona" }),
        expect.anything(),
      );
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toStrictEqual({
        code: "bad persona",
        legacy: "bad persona",
        message: [
          "data/attributes/payload/data/attributes/fields Either monthlyPurchasesRange or expectedMonthlyVolume must have a value",
        ],
      });
      expect(panda.createUser).not.toHaveBeenCalled();
    });
  });
});

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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(true);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(false);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(true);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(true);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(true);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(false);
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
    expect(issue && PersonaUtils.isMissingOrNull(issue)).toBe(true);
  });
});

describe("evaluate scope", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("throws when scope is not supported", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

    await expect(
      PersonaUtils.getPendingInquiryTemplate("reference-id", "invalid" as PersonaUtils.AccountScope),
    ).rejects.toThrow(`unhandled account scope: invalid`);
  });

  describe("basic", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PersonaUtils.PANDA_TEMPLATE);
    });

    it("returns panda template when all fields are missing", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve(emptyAccount) } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PersonaUtils.PANDA_TEMPLATE);
    });

    it("returns undefined when account exists and is valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(basicAccount),
      } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBeUndefined();
    });

    it("throws when account exists but is invalid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "acc-123", type: "account", attributes: { "country-code": 3 } }] }),
      } as Response);

      await expect(PersonaUtils.getPendingInquiryTemplate("reference-id", "basic")).rejects.toThrow(
        PersonaUtils.scopeValidationErrors.INVALID_SCOPE_VALIDATION,
      );
    });
  });

  describe("manteca", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PersonaUtils.PANDA_TEMPLATE);
    });

    it("returns manteca template when account exists and id class is allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(basicAccount),
      } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(PersonaUtils.MANTECA_TEMPLATE_EXTRA_FIELDS);
    });

    it("throws when account exists but country is not allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                ...mantecaAccount.data[0],
                attributes: {
                  ...mantecaAccount.data[0]?.attributes,
                  "country-code": "XX",
                },
              },
            ],
          }),
      } as Response);

      await expect(PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca")).rejects.toThrow(
        PersonaUtils.scopeValidationErrors.NOT_SUPPORTED,
      );
    });

    it("returns panda template when account exists but basic scope is not valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(emptyAccount),
      } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(PersonaUtils.PANDA_TEMPLATE);
    });

    it("returns manteca template when new account has a id class that is not allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                ...basicAccount.data[0],
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
          }),
      } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBe(PersonaUtils.MANTECA_TEMPLATE_WITH_ID_CLASS);
    });

    it("returns undefined when account exists and id class is allowed", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(mantecaAccount),
      } as Response);

      const result = await PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca");

      expect(result).toBeUndefined();
    });

    it("throws when schema validation fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                ...mantecaAccount.data[0],
                attributes: {
                  ...mantecaAccount.data[0]?.attributes,
                  fields: {
                    ...mantecaAccount.data[0]?.attributes.fields,
                    tin: { type: "string", value: 123 },
                  },
                },
              },
            ],
          }),
      } as Response);

      await expect(PersonaUtils.getPendingInquiryTemplate("reference-id", "manteca")).rejects.toThrow(
        PersonaUtils.scopeValidationErrors.INVALID_SCOPE_VALIDATION,
      );
    });
  });
});

describe("persona hook", () => {
  const bob = privateKeyToAddress(padHex("0xb0c"));
  const account = deriveAddress(inject("ExaAccountFactory"), { x: padHex(bob), y: zeroHash });

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: "persona-ref",
      publicKey: new Uint8Array(),
      factory: zeroAddress,
      account,
      pandaId: null,
    });
  });

  it("creates panda and pax user on valid inquiry", async () => {
    vi.mocked(createUser).mockResolvedValue({ id: "new-panda-id" });
    vi.mocked(addCapita).mockResolvedValue({});

    const response = await appClient.index.$post({
      header: { "persona-signature": "t=1,v1=sha256" },
      json: {
        ...validPayload,
        data: {
          ...validPayload.data,
          attributes: {
            ...validPayload.data.attributes,
            payload: {
              ...validPayload.data.attributes.payload,
              included: [...validPayload.data.attributes.payload.included],
            },
          },
        },
      },
    });

    expect(response.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith({
      accountPurpose: "business",
      annualSalary: "100000",
      expectedMonthlyVolume: "1000",
      ipAddress: "127.0.0.1",
      isTermsOfServiceAccepted: true,
      occupation: "engineer",
      personaShareToken: "inq_123",
    });
    expect(addCapita).toHaveBeenCalledWith({
      birthdate: "1990-01-01",
      document: "DOC123",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+1234567890",
      internalId: deriveAssociateId(account),
      product: "travel insurance",
    });
  });
});

const validPayload = {
  data: {
    attributes: {
      payload: {
        data: {
          id: "inq_123",
          attributes: {
            status: "approved",
            referenceId: "persona-ref",
            emailAddress: "john@example.com",
            phoneNumber: "+1234567890",
            birthdate: "1990-01-01",
            nameFirst: "John",
            nameMiddle: null,
            nameLast: "Doe",
            addressStreet1: "123 Main St",
            addressStreet2: null,
            addressCity: "New York",
            addressSubdivision: "NY",
            addressSubdivisionAbbr: "NY",
            addressPostalCode: "10001",
            fields: {
              accountPurpose: { value: "business" },
              annualSalary: { value: "100000" },
              expectedMonthlyVolume: { value: "1000" },
              inputSelect: { value: "engineer" },
              birthdate: { value: "1990-01-01" },
              identificationNumber: { value: "DOC123" },
              nameFirst: { value: "John" },
              nameLast: { value: "Doe" },
              emailAddress: { value: "john@example.com" },
              phoneNumber: { value: "+1234567890" },
              addressCountryCode: { value: "US" },
            },
          },
        },
        included: [
          {
            type: "inquiry-session",
            attributes: {
              createdAt: "2023-01-01T00:00:00.000Z",
              ipAddress: "127.0.0.1",
            },
          },
        ],
      },
    },
  },
} as const;

const personaPayload = {
  header: { "persona-signature": "t=1733865120,v1=debbacfe1b0c5f8797a1d68e8428fba435aa4ca3b5d9a328c3c96ee4d04d84df" },
  json: {
    data: {
      type: "event",
      id: "evt_nbYaPYyaDyKnPZc2ube6bbbbbbbb",
      attributes: {
        name: "inquiry.approved",
        createdAt: "2024-12-13T14:50:57.553Z",
        redactedAt: null,
        context: {
          inquiryPreviousStepName: "phone_a7cc55_confirmation",
          inquiryNextStepName: "success_397a55",
        },
        payload: {
          data: {
            type: "inquiry",
            id: "inq_xzMHQeuAt7KuxVMPNvowpYWJ6eee", // cspell:ignore inq_xzMHQeuAt7KuxVMPNvowpYWJ6eee
            attributes: {
              status: "approved",
              referenceId: "bob-persona",
              note: null,
              behaviors: {
                requestSpoofAttempts: 0,
                userAgentSpoofAttempts: 0,
                distractionEvents: 0,
                hesitationBaseline: 0,
                hesitationCount: 0,
                hesitationTime: 0,
                shortcutCopies: 0,
                shortcutPastes: 0,
                autofillCancels: 0,
                autofillStarts: 0,
                devtoolsOpen: false,
                completionTime: 402.488_082_249,
                hesitationPercentage: null,
                behaviorThreatLevel: "low",
              },
              tags: [],
              creator: "API",
              reviewerComment: null,
              updatedAt: "2024-12-13T14:50:57.000Z",
              createdAt: "2024-12-13T14:44:11.000Z",
              startedAt: "2024-12-13T14:45:46.000Z",
              completedAt: "2024-12-13T14:50:53.000Z",
              failedAt: null,
              markedForReviewAt: null,
              decisionedAt: "2024-12-13T14:50:57.000Z",
              expiredAt: null,
              redactedAt: null,
              previousStepName: "phone_a7d81_confirmation",
              nextStepName: "success_397a93",
              nameFirst: "TTTT HHHHH",
              nameMiddle: null,
              nameLast: "LLLL",
              birthdate: "1990-11-20",
              addressStreet1: "3A., No. 7, Ayi. 5, Ln. 34, Danyrony St.", // cspell:ignore Danyrony
              addressStreet2: null,
              addressCity: "Shalon Dyst.", // cspell:ignore Shalon Dyst.
              addressSubdivision: "New Taipei City",
              addressSubdivisionAbbr: null,
              addressPostalCode: "238000",
              addressPostalCodeAbbr: "238000",
              socialSecurityNumber: null,
              identificationNumber: "333333333",
              emailAddress: "a444q444s007@gmail.com",
              phoneNumber: "+886 999 999 999",
              fields: {
                inputSelect: {
                  type: "choices",
                  value: "IT and computing",
                },
                annualSalary: {
                  type: "string",
                  value: null,
                },
                expectedMonthlyVolume: {
                  type: "string",
                  value: null,
                },
                annualSalaryRangesUs150000: {
                  type: "choices",
                  value: "US$ 30.000 - US$ 70.000",
                },
                monthlyPurchasesRange: {
                  type: "choices",
                  value: "US$ 7.000 - US$ 15.000",
                },
                accountPurpose: {
                  type: "choices",
                  value: "Everyday purchases",
                },
                cryptoWalletAddress: {
                  type: "string",
                  value: null,
                },
                currentGovernmentId: {
                  type: "government_id",
                  value: {
                    id: "doc_yc294YWhCZi7YKxPnoxCGMmCH111", // cspell:ignore doc_yc294YWhCZi7YKxPnoxCGMmCH111
                    type: "Document::GovernmentId",
                  },
                },
                selectedCountryCode: {
                  type: "string",
                  value: "TW",
                },
                selectedIdClass: {
                  type: "string",
                  value: "pp",
                },
                "addressStreet-1": {
                  type: "string",
                  value: "3A., No. 7, Ayi. 5, Ln. 34, Danyrony St.", // cspell:ignore Danyrony
                },
                "addressStreet-2": {
                  type: "string",
                  value: null,
                },
                addressCity: {
                  type: "string",
                  value: "Shalon Dyst.", // cspell:ignore Shalon Dyst.
                },
                addressSubdivision: {
                  type: "string",
                  value: "New Taipei City",
                },
                addressPostalCode: {
                  type: "string",
                  value: "238000",
                },
                addressCountryCode: {
                  type: "string",
                  value: "TW",
                },
                birthdate: {
                  type: "date",
                  value: "1990-11-20",
                },
                emailAddress: {
                  type: "string",
                  value: "a444q444s007@gmail.com",
                },
                identificationClass: {
                  type: "string",
                  value: "pp",
                },
                identificationNumber: {
                  type: "string",
                  value: "333333333",
                },
                nameFirst: {
                  type: "string",
                  value: "TTTT HHHHH",
                },
                nameMiddle: {
                  type: "string",
                  value: null,
                },
                nameLast: {
                  type: "string",
                  value: "LLLL",
                },
                phoneNumber: {
                  type: "string",
                  value: "+886 999 999 999",
                },
                currentSelfie: {
                  type: "selfie",
                  value: {
                    id: "self_3rX4tDMpauxT1KC7CjUXy42mCLss", // cspell:ignore self_3rX4tDMpauxT1KC7CjUXy42mCLss
                    type: "Selfie::ProfileAndCenter",
                  },
                },
                collectedEmailAddress: {
                  type: "string",
                  value: null,
                },
                "newStepInputAddress-2": {
                  type: "string",
                  value: null,
                },
                "newStepInputAddress-3": {
                  type: "string",
                  value: null,
                },
                "newStepInputAddress-4": {
                  type: "string",
                  value: null,
                },
                "newStepInputAddress-5": {
                  type: "string",
                  value: null,
                },
                "newStepInputAddress-6": {
                  type: "string",
                  value: null,
                },
                illegalActivities: {
                  type: "choices",
                  value: "No",
                },
              },
            },
            relationships: {
              account: {
                data: {
                  type: "account",
                  id: "act_VoqJEhDYvmdMcAfm7UK", // cspell:ignore act_VoqJEhDYvmdMcAfm7UK
                },
              },
              template: {
                data: null,
              },
              inquiryTemplate: {
                data: {
                  type: "inquiry-template",
                  id: "itmpl_8uim4FvD57CW817", // cspell:ignore itmpl_8uim4FvD57CW817
                },
              },
              inquiryTemplateVersion: {
                data: {
                  type: "inquiry-template-version",
                  id: "itmplv_Rxvwxwo298U4zcG", // cspell:ignore itmplv_Rxvwxwo298U4zcG
                },
              },
              transaction: {
                data: null,
              },
              reviewer: {
                data: {
                  type: "workflow-run",
                  id: "wfr_k899djEZgjcygkCqffQJ7", // cspell:ignore wfr_k899djEZgjcygkCqffQJ7
                },
              },
              reports: {
                data: [
                  {
                    type: "report/watchlist",
                    id: "rep_DWQh673i2WiJc4a4Aq",
                  },
                  {
                    type: "report/politically-exposed-person",
                    id: "rep_edsffzFnw498JihArd", // cspell:ignore rep_edsffzFnw498JihArd
                  },
                ],
              },
              verifications: {
                data: [
                  {
                    type: "verification/government-id",
                    id: "ver_jsgwoJcJUGiy3eY", // cspell:ignore ver_jsgwoJcJUGiy3eY
                  },
                  {
                    type: "verification/selfie",
                    id: "ver_VybpFAAKrswHSUv", // cspell:ignore ver_VybpFAAKrswHSUv
                  },
                  {
                    type: "verification/email-address",
                    id: "ver_3j81WVFuxNERxVK",
                  },
                  {
                    type: "verification/phone-number",
                    id: "ver_r5iA1aT1bP8sdCHpBwz",
                  },
                  {
                    type: "verification/phone-number",
                    id: "ver_TDkgxHbdX3ARYHdJb3F", // cspell:ignore ver_TDkgxHbdX3ARYHdJb3F
                  },
                ],
              },
              sessions: {
                data: [
                  {
                    type: "inquiry-session",
                    id: "iqse_ah5RCvCT2K6EixEEYKHKA84", // cspell:ignore iqse_ah5RCvCT2K6EixEEYKHKA84
                  },
                ],
              },
              documents: {
                data: [
                  {
                    type: "document/government-id",
                    id: "doc_yc294YWhCZi7YKxPnoxCGMmCHMh1", // cspell:ignore doc_yc294YWhCZi7YKxPnoxCGMmCHMh1
                  },
                ],
              },
              selfies: {
                data: [
                  {
                    type: "selfie/profile-and-center",
                    id: "self_3rX4tDMpauxT1KC7CjUXy42ms", // cspell:ignore self_3rX4tDMpauxT1KC7CjUXy42ms
                  },
                ],
              },
            },
          },
          included: [
            {
              type: "inquiry-session",
              id: "iqse_QhgDKp56BpiBPwVZJAqa62", // cspell:ignore iqse_QhgDKp56BpiBPwVZJAqa62
              attributes: {
                status: "new",
                createdAt: "2025-02-06T14:52:17.000Z",
                startedAt: null,
                expiredAt: null,
                ipAddress: null,
                userAgent: null,
                osName: null,
                osFullVersion: null,
                deviceType: null,
                deviceName: null,
                browserName: null,
                browserFullVersion: null,
                mobileSdkName: null,
                mobileSdkFullVersion: null,
                deviceHandoffMethod: null,
                isProxy: null,
                isTor: null,
                isDatacenter: null,
                isVpn: false,
                threatLevel: null,
                countryCode: null,
                countryName: null,
                regionCode: null,
                regionName: null,
                latitude: null,
                longitude: null,
                gpsLatitude: null,
                gpsLongitude: null,
                gpsPrecision: null,
              },
              relationships: {
                inquiry: { data: { type: "inquiry", id: "inq_tizN68DngDWiC7wUk2F" } },
                device: { data: null },
                network: { data: null },
              },
            },
            {
              type: "inquiry-session",
              id: "iqse_oXoKgiZbL8JVSQ6abzgBFGh8NL7a", // cspell:ignore iqse_oXoKgiZbL8JVSQ6abzgBFGh8NL7a
              attributes: {
                status: "active",
                createdAt: "2025-02-06T03:13:43.000Z",
                startedAt: "2025-02-06T14:52:17.000Z",
                expiredAt: null,
                ipAddress: "181.167.222.5",
                userAgent: "Persona/1.0 (Android) Inquiry/2.12.17",
                osName: "Android",
                osFullVersion: "14",
                deviceType: "smartphone",
                deviceName: "samsung ",
                browserName: "Android Browser",
                browserFullVersion: "",
                mobileSdkName: "Inquiry",
                mobileSdkFullVersion: "2.12.17",
                deviceHandoffMethod: null,
                isProxy: false,
                isTor: false,
                isDatacenter: false,
                isVpn: false,
                threatLevel: "low",
                countryCode: "AR",
                countryName: "Argentina",
                regionCode: "B",
                regionName: "Buenos Aires",
                latitude: -30.9309,
                longitude: -50.9417,
                gpsLatitude: null,
                gpsLongitude: null,
                gpsPrecision: null,
              },
              relationships: {
                inquiry: { data: { type: "inquiry", id: "inq_tizN68DiC7wUk2F" } },
                device: { data: { type: "device", id: "dev_Yt89AfwbYXKHR1nQJdVRap" } }, // cspell:ignore dev_Yt89AfwbYXKHR1nQJdVRap
                network: { data: { type: "network", id: "net_fmycssHco2CTpFLa" } }, // cspell:ignore net_fmycssHco2CTpFLa
              },
            },
            {
              type: "account",
              id: "act_dkWXaYgsZD3P5QEoMP5M7pWQYdtN",
              attributes: {
                referenceId: "OpidDnEeUt2tmSFHAJnNZ3QeGXE", // cspell:ignore OpidDnEeUt2tmSFHAJnNZ3QeGXE
                createdAt: "2024-12-18T17:19:08.000Z",
                updatedAt: "2024-12-18T17:27:19.000Z",
                redactedAt: null,
                accountTypeName: "User",
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
                    value: {
                      filename: "center_photo_processed.jpg",
                      byte_size: 102_850,
                      url: "https://files.w8m1Q",
                    },
                  },
                },
                nameFirst: null,
                nameMiddle: null,
                nameLast: null,
                socialSecurityNumber: null,
                addressStreet1: null,
                addressStreet2: null,
                addressCity: null,
                addressSubdivision: null,
                addressPostalCode: null,
                countryCode: null,
                birthdate: null,
                phoneNumber: null,
                emailAddress: null,
                tags: [],
                identificationNumbers: {},
              },
              relationships: {
                accountType: {
                  data: {
                    type: "account-type",
                    id: "acttp_4a4T1s2JdSXCodbkgpRMmY3i", // cspell:ignore acttp_4a4T1s2JdSXCodbkgpRMmY3i
                  },
                },
              },
            },
            {
              type: "inquiry-template",
              id: "itmpl_8uim4FvD5P3kFpKHX37CW817", // cspell:ignore itmpl_8uim4FvD5P3kFpKHX37CW817
              attributes: {
                status: "active",
                name: "KYC: Government ID + Selfie",
              },
              relationships: {
                latestPublishedVersion: {
                  data: {
                    type: "inquiry-template-version",
                    id: "itmplv_unUfccv8RvdmfXiJMLL3WaeKqkZw", // cspell:ignore itmplv_unUfccv8RvdmfXiJMLL3WaeKqkZw
                  },
                },
              },
            },
            {
              type: "inquiry-session",
              id: "",
              attributes: {
                status: "active",
                createdAt: "2024-12-16T16:02:29.000Z",
                startedAt: "2024-12-16T16:02:29.000Z",
                expiredAt: null,
                ipAddress: "181.94.178.50",
                userAgent: "Persona/1.0 (iOS) Inquiry/2.22.5",
                osName: "iOS",
                osFullVersion: "18.1.1",
                deviceType: "smartphone",
                deviceName: "Apple iPhone14,2",
                browserName: null,
                browserFullVersion: null,
                mobileSdkName: "Inquiry",
                mobileSdkFullVersion: "2.22.5",
                deviceHandoffMethod: null,
                isProxy: false,
                isTor: false,
                isDatacenter: false,
                isVpn: false,
                threatLevel: "low",
                countryCode: "AR",
                countryName: "Argentina",
                regionCode: "X",
                regionName: "Cxra", // cspell:ignore Cxra
                latitude: -21.429,
                longitude: -24.1756,
                gpsLatitude: null,
                gpsLongitude: null,
                gpsPrecision: null,
              },
              relationships: {
                inquiry: {
                  data: {
                    type: "inquiry",
                    id: "inq_sA4NcQqdhQ9jQPHC", // cspell:ignore inq_sA4NcQqdhQ9jQPHC
                  },
                },
                device: {
                  data: {
                    type: "device",
                    id: "dev_N8Dw7DRzTkLE7",
                  },
                },
                network: {
                  data: {
                    type: "network",
                    id: "net_oyWoM9cJAp7A",
                  },
                },
              },
            },
            {
              type: "verification/government-id",
              id: "",
              attributes: {
                status: "passed",
                createdAt: "2024-12-16T16:03:35.000Z",
                createdAtTs: 1_734_365_015,
                submittedAt: "2024-12-16T16:03:36.000Z",
                submittedAtTs: 1_734_365_016,
                completedAt: "2024-12-16T16:03:43.000Z",
                completedAtTs: 1_734_365_023,
                countryCode: "AR",
                entityConfidenceScore: 99,
                idClass: "dl",
                captureMethod: "auto",
                nameFirst: " ",
                nameMiddle: null,
                nameLast: "",
                nameSuffix: null,
                birthdate: "2004-01-29",
                addressStreet1: "VALPA247", // cspell:ignore VALPA247
                addressStreet2: null,
                addressCity: "",
                addressSubdivision: "",
                addressPostalCode: null,
                issuingAuthority: null,
                issuingSubdivision: null,
                nationality: null,
                documentNumber: null,
                visaStatus: null,
                issueDate: "",
                expirationDate: "",
                designations: [],
                birthplace: null,
                endorsements: null,
                height: null,
                sex: null,
                restrictions: null,
                vehicleClass: null,
                identificationNumber: "",
                checks: [
                  {
                    name: "id_aamva_database_lookup", // cspell:ignore aamva
                    status: "not_applicable",
                    reasons: ["disabled_by_check_config"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_account_comparison",
                    status: "not_applicable",
                    reasons: ["missing_properties"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_age_comparison",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_age_inconsistency_detection",
                    status: "not_applicable",
                    reasons: ["disabled_by_check_config"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_attribute_comparison",
                    status: "not_applicable",
                    reasons: ["missing_properties"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_barcode_detection",
                    status: "not_applicable",
                    reasons: ["unsupported_country"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_barcode_inconsistency_detection",
                    status: "not_applicable",
                    reasons: ["unsupported_country"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_blur_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_color_inconsistency_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_compromised_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_disallowed_country_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {
                      countryCode: "AR",
                      selectedCountryCode: "AR",
                    },
                  },
                  {
                    name: "id_disallowed_type_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {
                      countryCode: "AR",
                      detectedIdClass: "dl",
                      detectedIdDesignations: [],
                      disallowedIdDesignations: [],
                      selectedIdClasses: ["dl"],
                    },
                  },
                  {
                    name: "id_double_side_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_electronic_replica_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_entity_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_expired_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_extraction_inconsistency_detection",
                    status: "not_applicable",
                    reasons: ["unsupported_country"],
                    requirement: "not_required",
                    metadata: {
                      checkRequirements: [],
                    },
                  },
                  {
                    name: "id_extracted_properties_detection",
                    status: "not_applicable",
                    reasons: ["no_required_properties"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_fabrication_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_glare_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_handwriting_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_inconsistent_repeat_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_inquiry_comparison",
                    status: "not_applicable",
                    reasons: ["missing_properties"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_mrz_detection",
                    status: "not_applicable",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_mrz_inconsistency_detection",
                    status: "not_applicable",
                    reasons: ["mrz_not_found"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_number_format_inconsistency_detection",
                    status: "not_applicable",
                    reasons: ["unsupported_country"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_paper_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_po_box_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_portrait_clarity_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_portrait_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_public_figure_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_real_id_detection",
                    status: "not_applicable",
                    reasons: ["disabled_by_check_config"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_repeat_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_selfie_comparison",
                    status: "not_applicable",
                    reasons: ["no_selfie"],
                    requirement: "required",
                    metadata: {},
                  },
                  {
                    name: "id_tamper_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_unprocessable_submission_detection",
                    status: "passed",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_valid_dates_detection",
                    status: "not_applicable",
                    reasons: [],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_video_quality_detection",
                    status: "not_applicable",
                    reasons: ["disabled"],
                    requirement: "not_required",
                    metadata: {},
                  },
                  {
                    name: "id_experimental_model_detection",
                    status: "not_applicable",
                    reasons: ["not_enabled"],
                    requirement: "not_required",
                    metadata: {},
                  },
                ],
              },
            },
          ],
        },
      },
    },
  },
} as const;

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

const mantecaAccount = {
  data: [
    {
      ...basicAccount.data[0],
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
