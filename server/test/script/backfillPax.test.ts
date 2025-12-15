import "../mocks/database";
import "../mocks/sentry";

import assert from "node:assert";
import { zeroAddress } from "viem";
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
  };
});

describe("backfillPax logic", () => {
  const testAccount = "0x1234567890123456789012345678901234567890";
  const testCredentialId = "backfill-test-cred";

  beforeAll(async () => {
    await database.insert(credentials).values({
      id: testCredentialId,
      publicKey: new Uint8Array(),
      factory: zeroAddress,
      account: testAccount,
      pandaId: "test-panda-id",
    });
    await database.insert(cards).values({
      id: "backfill-test-card",
      credentialId: testCredentialId,
      lastFour: "1234",
      status: "ACTIVE",
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("addCapita data mapping", () => {
    it("correctly maps Persona inquiry data to addCapita format", async () => {
      const mockInquiry = {
        id: "inq_123",
        type: "inquiry" as const,
        attributes: {
          status: "approved" as const,
          "reference-id": testCredentialId,
          "name-first": "John",
          "name-middle": null,
          "name-last": "Doe",
          "email-address": "john@example.com",
          "phone-number": "+1234567890",
          birthdate: "1990-01-01",
          fields: {
            "identification-number": { type: "string" as const, value: "DOC123" },
          },
        },
        relationships: {
          documents: null,
          account: null,
        },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(mockInquiry);
      vi.mocked(pax.addCapita).mockResolvedValue({});

      const results = await backfillPax(false);

      expect(results).toHaveLength(1);

      const result = results[0];
      assert(result);

      expect(result.status).toBe("success");

      const inquiry = await persona.getInquiry(testCredentialId, persona.PANDA_TEMPLATE);
      assert(inquiry, "Inquiry should be defined"); // This call is just to verify mock setup if needed, but the script calls it internally.

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

    it("skips users without approved Persona inquiry", async () => {
      const mockInquiry = {
        id: "inq_123",
        type: "inquiry" as const,
        attributes: {
          status: "pending" as const,
          "reference-id": testCredentialId,
          "name-first": null,
          "name-middle": null,
          "name-last": null,
          "email-address": null,
          "phone-number": null,
        },
        relationships: {
          documents: null,
          account: null,
        },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(mockInquiry);

      const results = await backfillPax(false);

      expect(results).toHaveLength(1);

      const result = results[0];
      assert(result);

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("pending");
      expect(pax.addCapita).not.toHaveBeenCalled();
    });

    it("skips users without any Persona inquiry", async () => {
      let noInquiry: Awaited<ReturnType<typeof persona.getInquiry>>;
      vi.mocked(persona.getInquiry).mockResolvedValue(noInquiry);

      const results = await backfillPax(false);

      expect(results).toHaveLength(1);

      const result = results[0];
      assert(result);

      expect(result.status).toBe("skipped");
      expect(result.reason).toContain("No Persona inquiry found");
      expect(pax.addCapita).not.toHaveBeenCalled();
    });

    it("handles missing optional fields gracefully", async () => {
      const mockInquiry = {
        id: "inq_123",
        type: "inquiry" as const,
        attributes: {
          status: "approved" as const,
          "reference-id": testCredentialId,
          "name-first": "Jane",
          "name-middle": null,
          "name-last": "Smith",
          "email-address": "jane@example.com",
          "phone-number": "",
          birthdate: "1985-05-15",
          fields: {
            "identification-number": undefined as unknown as { type: "string"; value: string | null | undefined },
          },
        },
        relationships: {
          documents: null,
          account: null,
        } satisfies unknown as { documents: null; account: null },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(
        mockInquiry as unknown as Awaited<ReturnType<typeof persona.getInquiry>>,
      );
      vi.mocked(pax.addCapita).mockResolvedValue({});

      await backfillPax(false);

      expect(pax.addCapita).toHaveBeenCalledWith(
        expect.objectContaining({
          document: "",
          phone: "",
        }),
      );
    });

    it("masks PII in logs during dry run", async () => {
      const mockInquiry = {
        id: "inq_123",
        type: "inquiry" as const,
        attributes: {
          status: "approved" as const,
          "name-first": "John",
          "name-last": "Doe",
          "email-address": "john@example.com",
          "phone-number": "+1234567890",
          birthdate: "1990-01-01",
          fields: {
            "identification-number": { value: "SECRET_DOC_123" },
          },
        },
        relationships: { documents: null, account: null },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(
        mockInquiry as unknown as Awaited<ReturnType<typeof persona.getInquiry>>,
      );

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

      await backfillPax(true);

      const dryRunLog = logSpy.mock.calls.find((call) => typeof call[0] === "string" && call[0].includes("[DRY-RUN]"));
      assert(dryRunLog, "Dry run log should be present");

      const loggedData = dryRunLog[1] as Record<string, unknown>;

      expect(loggedData.document).toBe("S***3");
      expect(loggedData.email).toBe("j***m");

      logSpy.mockRestore();
    });
  });

  describe("deriveAssociateId integration", () => {
    it("generates consistent internalId for same account", () => {
      const id1 = deriveAssociateId(testAccount);
      const id2 = deriveAssociateId(testAccount);

      expect(id1).toBe(id2);
      expect(id1).toHaveLength(7);
    });
  });

  describe("sequential processing", () => {
    it("processes all items sequentially with delay", async () => {
      vi.useFakeTimers();

      // Create 2 extra users (3 total: 1 from beforeAll + 2 here)
      for (let index = 0; index < 2; index++) {
        const account = `0x${index.toString(16).padStart(40, "0")}`;
        const credId = `extra-cred-${index}`;
        await database.insert(credentials).values({
          id: credId,
          publicKey: new Uint8Array(),
          factory: zeroAddress,
          account,
          pandaId: `panda-${index}`,
        });
        await database.insert(cards).values({
          id: `card-${index}`,
          credentialId: credId,
          lastFour: "1111",
          status: "ACTIVE",
        });
      }

      const mockInquiry = {
        id: "inq_valid",
        type: "inquiry" as const,
        attributes: {
          status: "approved" as const,
          "reference-id": "any",
          "name-first": "Test",
          "name-last": "User",
          "email-address": "test@test.com",
          "phone-number": "+123",
          birthdate: "2000-01-01",
          fields: { "identification-number": { value: "ID" } },
        },
        relationships: { documents: null, account: null },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(
        mockInquiry as unknown as Awaited<ReturnType<typeof persona.getInquiry>>,
      );
      vi.mocked(pax.addCapita).mockResolvedValue({});

      // Start backfill with 1s delay
      const promise = backfillPax(false, 1000);

      // Advance timers to trigger sequential processing
      await vi.runAllTimersAsync();

      const results = await promise;

      expect(results).toHaveLength(3);
      expect(pax.addCapita).toHaveBeenCalledTimes(3);

      vi.useRealTimers();
    });
  });
});
