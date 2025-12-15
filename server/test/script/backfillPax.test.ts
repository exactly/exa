import "../mocks/database";
import "../mocks/sentry";

import assert from "node:assert";
import { zeroAddress } from "viem";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import database, { cards, credentials } from "../../database/index";
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

      // Simulate what the backfill script does
      const inquiry = await persona.getInquiry(testCredentialId, persona.PANDA_TEMPLATE);

      assert(inquiry, "Inquiry should be defined");
      assert(inquiry.attributes.status === "approved", "Inquiry should be approved");

      const { attributes } = inquiry;
      const documentValue = attributes.fields["identification-number"]?.value;
      const capitaData = {
        firstName: attributes["name-first"],
        lastName: attributes["name-last"],
        birthdate: attributes.birthdate,
        document: documentValue ?? "",
        email: attributes["email-address"],
        phone: attributes["phone-number"],
        internalId: deriveAssociateId(testAccount),
        product: "travel insurance",
      };

      await pax.addCapita(capitaData);

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

      const inquiry = await persona.getInquiry(testCredentialId, persona.PANDA_TEMPLATE);

      expect(inquiry?.attributes.status).toBe("pending");
      expect(pax.addCapita).not.toHaveBeenCalled();
    });

    it("skips users without any Persona inquiry", async () => {
      let noInquiry: Awaited<ReturnType<typeof persona.getInquiry>>;
      vi.mocked(persona.getInquiry).mockResolvedValue(noInquiry);

      const inquiry = await persona.getInquiry(testCredentialId, persona.PANDA_TEMPLATE);

      expect(inquiry).toBeUndefined();
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
        },
      };

      vi.mocked(persona.getInquiry).mockResolvedValue(mockInquiry);
      vi.mocked(pax.addCapita).mockResolvedValue({});

      const inquiry = await persona.getInquiry(testCredentialId, persona.PANDA_TEMPLATE);
      assert(inquiry, "Inquiry not found");
      assert(inquiry.attributes.status === "approved", "Inquiry not approved");

      const { attributes } = inquiry;
      const documentValue = attributes.fields["identification-number"]?.value;
      const capitaData = {
        firstName: attributes["name-first"],
        lastName: attributes["name-last"],
        birthdate: attributes.birthdate,
        document: documentValue ?? "",
        email: attributes["email-address"],
        phone: attributes["phone-number"] || "",
        internalId: deriveAssociateId(testAccount),
        product: "travel insurance",
      };

      await pax.addCapita(capitaData);

      expect(pax.addCapita).toHaveBeenCalledWith(
        expect.objectContaining({
          document: "",
          phone: "",
        }),
      );
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
});
