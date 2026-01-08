import { Address } from "@exactly/common/validation";
import { parse } from "valibot";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as pax from "../../utils/pax";

describe("pax integration", () => {
  beforeEach(() => {
    vi.spyOn(global, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
      text: () => Promise.resolve(""),
    } as Response);
  });

  afterEach(() => vi.restoreAllMocks());

  describe("add capita", () => {
    it("should call the correct endpoint with correct headers and body", async () => {
      const capitaData = {
        firstName: "Juan",
        lastName: "Doe",
        document: "32323",
        birthdate: "1997-01-01",
        email: "test@test.com",
        phone: "+54111212112121",
        product: "PRODUCT_NAME",
        internalId: "test-id",
      };
      await pax.addCapita(capitaData);

      expect(fetch).toHaveBeenCalledWith("https://pax.test/api/capita", {
        method: "POST",
        headers: expect.objectContaining({ "x-api-key": "pax", "content-type": "application/json" }) as unknown,
        body: JSON.stringify(capitaData),
        signal: expect.any(AbortSignal) as unknown,
      });
    });

    it("should handle optional fields", async () => {
      const capitaData = {
        firstName: "Juan",
        lastName: "Doe",
        document: "32323",
        birthdate: "1997-01-01",
        email: "test@test.com",
        phone: "+54111212112121",
        product: "PRODUCT_NAME",
        internalId: "123",
        internalGroupId: "GROUP1",
      };
      await pax.addCapita(capitaData);

      expect(fetch).toHaveBeenCalledWith("https://pax.test/api/capita", {
        method: "POST",
        headers: expect.any(Object) as unknown,
        body: JSON.stringify(capitaData),
        signal: expect.any(AbortSignal) as unknown,
      });
    });

    it("should throw an error on API failure", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 400,
        text: () => Promise.resolve("Bad Request"),
      } as Response);

      await expect(
        pax.addCapita({
          firstName: "Juan",
          lastName: "Doe",
          document: "32323",
          birthdate: "1997-01-01",
          email: "test@test.com",
          phone: "+54111212112121",
          product: "PRODUCT_NAME",
          internalId: "test-id",
        }),
      ).rejects.toThrow("400 Bad Request");
    });
  });

  describe("removeCapita", () => {
    it("should call the DELETE endpoint correctly", async () => {
      const internalId = "test-id-123";
      await pax.removeCapita(internalId);

      expect(fetch).toHaveBeenCalledWith(`https://pax.test/api/capita/${internalId}`, {
        method: "DELETE",
        headers: expect.objectContaining({ "x-api-key": "pax" }) as unknown,
        body: undefined,
        signal: expect.any(AbortSignal) as unknown,
      });
    });

    it("should throw on error", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      } as Response);

      await expect(pax.removeCapita("missing-id")).rejects.toThrow("404 Not Found");
    });
  });

  describe("deriveAssociateId", () => {
    it("should return a 10-character string", () => {
      const id = pax.deriveAssociateId(parse(Address, privateKeyToAddress(generatePrivateKey())));

      expect(id).toHaveLength(10);
    });

    it("should be deterministic", () => {
      const account = parse(Address, privateKeyToAddress(generatePrivateKey()));
      const id1 = pax.deriveAssociateId(account);
      const id2 = pax.deriveAssociateId(account);

      expect(id1).toBe(id2);
    });

    it("should return different IDs for different accounts", () => {
      const id1 = pax.deriveAssociateId(parse(Address, privateKeyToAddress(generatePrivateKey())));
      const id2 = pax.deriveAssociateId(parse(Address, privateKeyToAddress(generatePrivateKey())));

      expect(id1).not.toBe(id2);
    });

    it("should be alphanumeric (base36)", () => {
      const id = pax.deriveAssociateId(parse(Address, privateKeyToAddress(generatePrivateKey())));

      expect(id).toMatch(/^[0-9a-z]+$/);
    });
  });
});
