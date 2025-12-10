import "../mocks/sentry";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  evaluateScope,
  MANTECA_TEMPLATE_WITH_ID_CLASS,
  PANDA_TEMPLATE,
  scopeValidationErrors,
} from "../../utils/persona";

const mockFetch = vi.spyOn(global, "fetch");

describe("evaluate scope", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("basic", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await evaluateScope("ref-123", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("returns undefined when account exists and is valid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({ data: [{ id: "acc-123", type: "account", attributes: { "country-code": "US" } }] }),
      } as Response);

      const result = await evaluateScope("ref-123", "basic");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBeUndefined();
    });

    it("throws when account exists but is invalid", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ data: [{ id: "acc-123", type: "account", attributes: { "country-code": 3 } }] }),
      } as Response);

      await expect(evaluateScope("ref-123", "basic")).rejects.toThrow(scopeValidationErrors.INVALID_SCOPE_VALIDATION);
    });
  });

  describe("manteca", () => {
    it("returns panda template when account not found", async () => {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ data: [] }) } as Response);

      const result = await evaluateScope("ref-123", "manteca");

      expect(mockFetch).toHaveBeenCalledOnce();
      expect(result).toBe(PANDA_TEMPLATE);
    });

    it("throws when country is not supported", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            data: [
              {
                id: "acc-123",
                type: "account",
                attributes: {
                  "country-code": "XX",
                  fields: {
                    isnotfacta: { type: "boolean", value: true },
                    tin: { type: "string", value: "12345678" },
                    sex_1: { type: "string", value: "Male" },
                    manteca_t_c: { type: "boolean", value: true },
                  },
                },
              },
            ],
          }),
      } as Response);

      await expect(evaluateScope("ref-123", "manteca")).rejects.toThrow(scopeValidationErrors.NOT_SUPPORTED);
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
                  fields: {
                    isnotfacta: { type: "boolean", value: true },
                    tin: { type: "string", value: "12345678" },
                    sex_1: { type: "string", value: "Male" },
                    manteca_t_c: { type: "boolean", value: true },
                  },
                },
              },
            ],
          }),
      } as Response);

      const result = await evaluateScope("ref-123", "manteca");

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
                    isnotfacta: { type: "boolean", value: true },
                    tin: { type: "string", value: "12345678" },
                    sex_1: { type: "string", value: "Male" },
                    manteca_t_c: { type: "boolean", value: true },
                  },
                },
              },
            ],
          }),
      } as Response);

      const result = await evaluateScope("ref-123", "manteca");

      expect(result).toBeUndefined();
    });
  });
});
