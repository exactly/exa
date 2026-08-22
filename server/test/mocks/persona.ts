import { vValidator } from "@hono/valibot-validator";
import { object, string } from "valibot";
import { vi } from "vitest";

import type * as PersonaModule from "../../utils/persona";

type Persona = ReturnType<typeof PersonaModule.default>;

const mock = vi.hoisted(() => {
  let instance: Persona | undefined;
  function current() {
    if (!instance) throw new Error("persona not initialized");
    return instance;
  }
  return {
    set(value: Persona) {
      instance = value;
    },
    persona: {
      addDocument: (...parameters: Parameters<Persona["addDocument"]>) => current().addDocument(...parameters),
      createInquiry: (...parameters: Parameters<Persona["createInquiry"]>) => current().createInquiry(...parameters),
      evaluateAccount: (...parameters: Parameters<Persona["evaluateAccount"]>) =>
        current().evaluateAccount(...parameters),
      getAccount: <T extends Parameters<Persona["getAccount"]>[1]>(referenceId: string, scope: T) =>
        current().getAccount(referenceId, scope),
      getAccounts: (...parameters: Parameters<Persona["getAccounts"]>) => current().getAccounts(...parameters),
      getCardLimitStatus: (...parameters: Parameters<Persona["getCardLimitStatus"]>) =>
        current().getCardLimitStatus(...parameters),
      getDocument: (...parameters: Parameters<Persona["getDocument"]>) => current().getDocument(...parameters),
      getDocumentForBridge: (...parameters: Parameters<Persona["getDocumentForBridge"]>) =>
        current().getDocumentForBridge(...parameters),
      getDocumentForManteca: (...parameters: Parameters<Persona["getDocumentForManteca"]>) =>
        current().getDocumentForManteca(...parameters),
      getInquiry: (...parameters: Parameters<Persona["getInquiry"]>) => current().getInquiry(...parameters),
      getInquiryById: (...parameters: Parameters<Persona["getInquiryById"]>) => current().getInquiryById(...parameters),
      getPendingInquiryTemplate: (...parameters: Parameters<Persona["getPendingInquiryTemplate"]>) =>
        current().getPendingInquiryTemplate(...parameters),
      getUnknownAccount: (...parameters: Parameters<Persona["getUnknownAccount"]>) =>
        current().getUnknownAccount(...parameters),
      getValidDocumentForManteca: (...parameters: Parameters<Persona["getValidDocumentForManteca"]>) =>
        current().getValidDocumentForManteca(...parameters),
      resumeInquiry: (...parameters: Parameters<Persona["resumeInquiry"]>) => current().resumeInquiry(...parameters),
      searchAccounts: (...parameters: Parameters<Persona["searchAccounts"]>) => current().searchAccounts(...parameters),
      updateCardLimit: (...parameters: Parameters<Persona["updateCardLimit"]>) =>
        current().updateCardLimit(...parameters),
    },
  };
});
const { persona } = mock;

vi.mock("../../utils/persona", async (importOriginal) => {
  const module = await importOriginal<typeof PersonaModule>();
  return {
    ...module,
    default: (...parameters: Parameters<typeof module.default>) => {
      mock.set(module.default(...parameters));
      return persona;
    },
    headerValidator: () => vValidator("header", object({ "persona-signature": string() }), (_result, _c) => undefined),
  };
});
