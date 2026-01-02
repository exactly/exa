import "../mocks/sentry";

import type { Address } from "@exactly/common/validation";
import { inArray } from "drizzle-orm";
import assert from "node:assert";
import type { InferOutput } from "valibot";
import { zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { cards, credentials } from "../../database/index";
import backfillPax from "../../script/backfillPax";
import * as pax from "../../utils/pax";
import { deriveAssociateId } from "../../utils/pax";
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

  const testCredentialId = `backfill-test-cred-${testAccount}`;
  const testCredentialId2 = `backfill-test-cred-${testAccount2}`;
  // use uuid format for Rain cards
  const testCardId = "11111111-1111-4111-a111-111111111111";
  const testCardId2 = "22222222-2222-4222-a222-222222222222";

  beforeAll(async () => {
    // insert user 1
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
      productId: "test-rain-product-id",
    });

    // insert user 2
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
      productId: "test-rain-product-id-2",
    });
  });

  afterAll(async () => {
    // cleanup test data
    await database.delete(cards).where(inArray(cards.id, [testCardId, testCardId2]));
    await database.delete(credentials).where(inArray(credentials.id, [testCredentialId, testCredentialId2]));
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("backfillPax logic", () => {
    it("correctly maps Persona inquiry data to addCapita format", async () => {
      const mockInquiry = createMockInquiry();

      vi.mocked(persona.getInquiry).mockImplementation((referenceId, _templateId) =>
        Promise.resolve(referenceId === testCredentialId ? mockInquiry : undefined),
      );
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
        internalId: deriveAssociateId(testAccount as Address),
        product: "travel insurance",
      });
    });
  });

  describe("filtering and skipping", () => {
    it("skips users in Bangladesh", async () => {
      vi.mocked(persona.getInquiry).mockImplementation((referenceId, _templateId) =>
        Promise.resolve(referenceId === testCredentialId ? createMockInquiry({ status: "approved" }) : undefined),
      );

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

    // this test uses mock call tracking instead of result counting because backfillPax
    // queries the real database, and in CI other parallel tests may insert users,
    // causing flaky assertions on absolute counts. by comparing two runs (baseline vs skipped)
    // within the same test, we ensure deterministic behavior regardless of external data.
    it("skips first N users when requested", async () => {
      const calledCredentialIds: string[] = [];
      vi.mocked(persona.getInquiry).mockImplementation((referenceId, _templateId) => {
        calledCredentialIds.push(referenceId);
        return Promise.resolve(
          referenceId === testCredentialId || referenceId === testCredentialId2 ? createMockInquiry() : undefined,
        );
      });
      vi.mocked(persona.getAccount).mockResolvedValue(createMockAccount());

      // first run without skip to establish baseline call order
      const baselineCallIds: string[] = [];
      vi.mocked(persona.getInquiry).mockImplementation((referenceId, _templateId) => {
        baselineCallIds.push(referenceId);
        return Promise.resolve(
          referenceId === testCredentialId || referenceId === testCredentialId2 ? createMockInquiry() : undefined,
        );
      });
      await backfillPax(false, 0, 0);

      // now run with skip=1, which should skip the first sorted user
      calledCredentialIds.length = 0; // reset
      vi.mocked(persona.getInquiry).mockImplementation((referenceId, _templateId) => {
        calledCredentialIds.push(referenceId);
        return Promise.resolve(
          referenceId === testCredentialId || referenceId === testCredentialId2 ? createMockInquiry() : undefined,
        );
      });
      await backfillPax(false, 0, 1);

      // verify: with skip=1, we should have one fewer call than baseline
      expect(calledCredentialIds).toHaveLength(baselineCallIds.length - 1);

      // verify: the first user from baseline should NOT be in the skipped run
      const firstBaselineId = baselineCallIds[0];
      assert(firstBaselineId, "expected at least one baseline call");
      expect(calledCredentialIds).not.toContain(firstBaselineId);
    });
  });
});
