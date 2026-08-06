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
    default: () => {
      return {
        addDocument: (referenceId: string, document: Parameters<typeof persona.addDocument>[1]) =>
          module.addDocument(referenceId, document),
        createInquiry: (
          ...params: [
            referenceId: string,
            templateId: string,
            redirectURI?: string,
            fields?: { "name-first": string; "name-last": string },
          ]
        ) => module.createInquiry(...params),
        getAccount: <T extends Persona.AccountScope>(referenceId: string, scope: T) =>
          module.getAccount(referenceId, scope),
        getCardLimitStatus: (referenceId: string, account?: Parameters<typeof persona.getCardLimitStatus>[1]) =>
          module.getCardLimitStatus(referenceId, account),
        getDocument: (documentId: string) => module.getDocument(documentId),
        getDocumentForManteca: (documents: Parameters<typeof persona.getDocumentForManteca>[0], country: string) =>
          module.getDocumentForManteca(documents, country),
        getInquiry: (referenceId: string, templateId: string) => module.getInquiry(referenceId, templateId),
        getInquiryById: (id: string) => module.getInquiryById(id),
        getPendingInquiryTemplate: (referenceId: string, scope: Persona.AccountScope) =>
          module.getPendingInquiryTemplate(referenceId, scope),
        getUnknownAccount: (referenceId: string) => module.getUnknownAccount(referenceId),
        resumeInquiry: (inquiryId: string) => module.resumeInquiry(inquiryId),
        searchAccounts: (email: string) => module.searchAccounts(email),
        updateCardLimit: (referenceId: string, limitUsd: number) => module.updateCardLimit(referenceId, limitUsd),
      };
    },
  });
});
