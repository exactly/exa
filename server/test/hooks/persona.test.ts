import "../mocks/sentry";
import "../mocks/database";
import "../mocks/persona";

import deriveAddress from "@exactly/common/deriveAddress";
import { captureException } from "@sentry/node";
import { eq } from "drizzle-orm";
import { testClient } from "hono/testing";
import { padHex, zeroAddress, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeAll, describe, expect, inject, it, vi } from "vitest";

import database, { credentials } from "../../database";
import app from "../../hooks/persona";
import * as panda from "../../utils/panda";

const appClient = testClient(app);

vi.mock("@sentry/node", { spy: true });

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
    const id = "panda-id";
    vi.spyOn(panda, "createUser").mockResolvedValueOnce({ id });
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
                attributes: { ...personaPayload.json.data.attributes.payload.data.attributes, referenceId: account },
              },
              included: [...personaPayload.json.data.attributes.payload.included],
            },
          },
        },
      },
    });
    const p = await database.query.credentials.findFirst({
      where: eq(credentials.id, account),
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
            id: "inq_xzMHQeuAt7KuxVMPNvowpYWJ6eee", // cspell:disable-line
            attributes: {
              status: "approved",
              referenceId: "reference-123",
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
              addressStreet1: "3A., No. 7, Ayi. 5, Ln. 34, Danyrony St.", // cspell:disable-line
              addressStreet2: null,
              addressCity: "Shalon Dyst.", // cspell:disable-line
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
                    id: "doc_yc294YWhCZi7YKxPnoxCGMmCH111", // cspell:disable-line
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
                  value: "3A., No. 7, Ayi. 5, Ln. 34, Danyrony St.", // cspell:disable-line
                },
                "addressStreet-2": {
                  type: "string",
                  value: null,
                },
                addressCity: {
                  type: "string",
                  value: "Shalon Dyst.", // cspell:disable-line
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
                    id: "self_3rX4tDMpauxT1KC7CjUXy42mCLss", // cspell:disable-line
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
                  id: "act_VoqJEhDYvmdMcAfm7UK", // cspell:disable-line
                },
              },
              template: {
                data: null,
              },
              inquiryTemplate: {
                data: {
                  type: "inquiry-template",
                  id: "itmpl_8uim4FvD57CW817", // cspell:disable-line
                },
              },
              inquiryTemplateVersion: {
                data: {
                  type: "inquiry-template-version",
                  id: "itmplv_Rxvwxwo298U4zcG", // cspell:disable-line
                },
              },
              transaction: {
                data: null,
              },
              reviewer: {
                data: {
                  type: "workflow-run",
                  id: "wfr_k899djEZgjcygkCqffQJ7", // cspell:disable-line
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
                    id: "rep_edsffzFnw498JihArd", // cspell:disable-line
                  },
                ],
              },
              verifications: {
                data: [
                  {
                    type: "verification/government-id",
                    id: "ver_jsgwoJcJUGiy3eY", // cspell:disable-line
                  },
                  {
                    type: "verification/selfie",
                    id: "ver_VybpFAAKrswHSUv", // cspell:disable-line
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
                    id: "ver_TDkgxHbdX3ARYHdJb3F", // cspell:disable-line
                  },
                ],
              },
              sessions: {
                data: [
                  {
                    type: "inquiry-session",
                    id: "iqse_ah5RCvCT2K6EixEEYKHKA84", // cspell:disable-line
                  },
                ],
              },
              documents: {
                data: [
                  {
                    type: "document/government-id",
                    id: "doc_yc294YWhCZi7YKxPnoxCGMmCHMh1", // cspell:disable-line
                  },
                ],
              },
              selfies: {
                data: [
                  {
                    type: "selfie/profile-and-center",
                    id: "self_3rX4tDMpauxT1KC7CjUXy42ms", // cspell:disable-line
                  },
                ],
              },
            },
          },
          included: [
            {
              type: "inquiry-session",
              id: "iqse_QhgDKp56BpiBPwVZJAqa62", // cspell:disable-line
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
              id: "iqse_oXoKgiZbL8JVSQ6abzgBFGh8NL7a", // cspell:disable-line
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
                device: { data: { type: "device", id: "dev_Yt89AfwbYXKHR1nQJdVRap" } }, // cspell:disable-line
                network: { data: { type: "network", id: "net_fmycssHco2CTpFLa" } }, // cspell:disable-line
              },
            },
            {
              type: "account",
              id: "act_dkWXaYgsZD3P5QEoMP5M7pWQYdtN",
              attributes: {
                referenceId: "OpidDnEeUt2tmSFHAJnNZ3QeGXE", // cspell:disable-line
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
                    id: "acttp_4a4T1s2JdSXCodbkgpRMmY3i", // cspell:disable-line
                  },
                },
              },
            },
            {
              type: "inquiry-template",
              id: "itmpl_8uim4FvD5P3kFpKHX37CW817", // cspell:disable-line
              attributes: {
                status: "active",
                name: "KYC: Government ID + Selfie",
              },
              relationships: {
                latestPublishedVersion: {
                  data: {
                    type: "inquiry-template-version",
                    id: "itmplv_unUfccv8RvdmfXiJMLL3WaeKqkZw", // cspell:disable-line
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
                regionName: "Cxra", // cspell:disable-line
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
                    id: "inq_sA4NcQqdhQ9jQPHC", // cspell:disable-line
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
                addressStreet1: "VALPA247", // cspell:disable-line
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
                    name: "id_aamva_database_lookup", // cspell:disable-line
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
