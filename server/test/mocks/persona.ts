import { vValidator } from "@hono/valibot-validator";
import { object, string } from "valibot";
import { vi } from "vitest";

import type * as Persona from "../../utils/persona";

vi.mock("../../utils/persona", async (importOriginal) => {
  const persona = await importOriginal<typeof Persona>();
  const module = {
    ...persona,
    headerValidator: () => vValidator("header", object({ "persona-signature": string() }), (r, c) => undefined),
  };
  return Object.assign(module, {
    default: (key: string, url: string) => {
      const provider = { key, url };
      return {
        addDocument: (referenceId: string, document: Parameters<typeof persona.addDocument>[1]) =>
          module.addDocument(referenceId, document, provider),
        getInquiryById: (id: string) => module.getInquiryById(id, provider),
        searchAccounts: (email: string) => module.searchAccounts(email, provider),
        updateCardLimit: (referenceId: string, limitUsd: number) =>
          module.updateCardLimit(referenceId, limitUsd, provider),
      };
    },
  });
});
