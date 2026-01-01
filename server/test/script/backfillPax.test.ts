import "../mocks/sentry";

import assert from "node:assert";
import type { InferOutput } from "valibot";
import { zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { cards, credentials } from "../../database/index";
import backfillPax from "../../script/backfillPax";
import deriveAssociateId from "../../utils/deriveAssociateId";
import * as pax from "../../utils/pax";
import * as persona from "../../utils/persona";

vi.mock("../../utils/pax");
vi.mock("../../utils/persona", async (importOriginal) => {
  const original = await importOriginal<typeof persona>();
  return {
    ...original,
    getInquiry: vi.fn<typeof persona.getInquiry>(),
    getAccount: vi.fn<typeof persona.getAccount>(),
  };
});

// Helper type for the raw inquiry structure returned by getInquiry
// Based on utils/persona.ts Inquiry schema
type Inquiry = InferOutput<typeof persona.Inquiry>;
type Account = InferOutput<typeof persona.Account>;

// Base mock object generator to avoid repetition and satisfying types
const createMockInquiry = (overrides: Partial<Inquiry["attributes"]> = {}): Inquiry =>
  ({
    id: "inq_123",
    type: "inquiry",
    attributes: {
      status: "approved",
      "reference-id": "backfill-test-cred",
      "name-first": "John",
      "name-middle": null,
      "name-last": "Doe",
      "email-address": "john@example.com",
      "phone-number": "+1234567890",
      birthdate: "1990-01-01",
      fields: {
        "identification-number": { type: "string", value: "DOC123" },
      },
      ...overrides,
    },
    relationships: {
      documents: { data: [] },
      account: { data: { id: "acc_123", type: "account" } },
    },
  }) as Inquiry;

const createMockAccount = (overrides: Partial<Account["attributes"]> = {}): Account => ({
  id: "acc_123",
  type: "account",
  attributes: {
    "country-code": "US",
    fields: {
      // cspell:ignore isnotfacta
      isnotfacta: null,
      tin: null,
      sex_1: null,
      manteca_t_c: null,
      address: {
        type: "hash",
        value: { country_code: { type: "string", value: "US" } },
      },
    },
    ...overrides,
  },
});

describe("backfillPax logic", () => {
  const account1Key = generatePrivateKey();
  const testAccount = privateKeyToAddress(account1Key);

  const account2Key = generatePrivateKey();
  const testAccount2 = privateKeyToAddress(account2Key);
  const sortedAccounts = [testAccount, testAccount2].sort();
  const testCredentialId = `backfill-test-cred-${testAccount}`;
  const testCredentialId2 = `backfill-test-cred-${testAccount2}`;
  const testCardId = `backfill-test-card-${testAccount}`;
  const testCardId2 = `backfill-test-card-${testAccount2}`;

  beforeAll(async () => {
    // Insert user 1
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      factory: zeroAddress,
      account: testAccount,
      pandaId: "test-panda-id",
    });
    await database.insert(cards).values({
      id: testCardId,
      credentialId: testCredentialId,
      lastFour: "1234",
      status: "ACTIVE",
    });

    // Insert user 2
    await database.insert(credentials).values({
      id: testCredentialId2,
      publicKey: new Uint8Array(),
      factory: zeroAddress,
      account: testAccount2,
      pandaId: "test-panda-id-2",
    });
    await database.insert(cards).values({
      id: testCardId2,
      credentialId: testCredentialId2,
      lastFour: "5678",
      status: "ACTIVE",
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("backfillPax logic", () => {
    it("correctly maps Persona inquiry data to addCapita format", async () => {
      const mockInquiry = createMockInquiry();

      vi.mocked(persona.getInquiry).mockImplementation((id) => {
        if (id === testCredentialId) return Promise.resolve(mockInquiry);
        return Promise.resolve(undefined as Inquiry | undefined);
      });
      vi.mocked(persona.getAccount).mockResolvedValue(createMockAccount());
      vi.mocked(pax.addCapita).mockResolvedValue({});

      const results = await backfillPax(false);

      const successResult = results.find((r) => r.account === testAccount);
      assert(successResult);
      expect(successResult.status).toBe("success");

      expect(pax.addCapita).toHaveBeenCalledWith({
        firstName: "John",
        lastName: "Doe",
        birthdate: "1990-01-01",
        document: "DOC123",
        email: "john@example.com",
        phone: "+1234567890",
        internalId: deriveAssociateId(testAccount),
        product: "travel insurance",
      });
    });
  });

  describe("filtering and skipping", () => {
    it("skips users in Bangladesh", async () => {
      vi.mocked(persona.getInquiry).mockImplementation((id) => {
        if (id === testCredentialId) {
          return Promise.resolve(createMockInquiry({ status: "approved" }));
        }
        return Promise.resolve(undefined as Inquiry | undefined);
      });

      vi.mocked(persona.getAccount).mockImplementation((id) => {
        if (id === testCredentialId) {
          return Promise.resolve(
            createMockAccount({
              fields: {
                address: {
                  type: "hash",
                  value: {
                    country_code: { type: "string", value: "BD" },
                  },
                },
              },
            }),
          );
        }
        return Promise.resolve(createMockAccount());
      });

      const results = await backfillPax(false);
      const bdUser = results.find((r) => r.account === testAccount);
      assert(bdUser);

      expect(bdUser.status).toBe("skipped");
      expect(bdUser.reason).toBe("User is in Bangladesh");
    });

    it("sorts users by account", async () => {
      const callOrder: string[] = [];
      vi.mocked(persona.getInquiry).mockImplementation((id) => {
        if (id === testCredentialId) callOrder.push(testAccount);
        if (id === testCredentialId2) callOrder.push(testAccount2);
        return Promise.resolve(createMockInquiry());
      });
      vi.mocked(persona.getAccount).mockResolvedValue(createMockAccount());

      await backfillPax(false);

      expect(callOrder).toEqual([testAccount, testAccount2].sort());
    });

    it("skips first N users when requested", async () => {
      vi.mocked(persona.getInquiry).mockResolvedValue(createMockInquiry());
      vi.mocked(persona.getAccount).mockResolvedValue(createMockAccount());

      const results = await backfillPax(false, 0, 1);

      expect(results).toHaveLength(1); // Only processing remaining users
      assert(results[0]);
      expect(results[0].account).toBe(sortedAccounts[1]);
    });
  });
});
