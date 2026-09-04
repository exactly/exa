import { vValidator } from "@hono/valibot-validator";
import { object, string } from "valibot";
import { vi } from "vitest";

import type * as PandaModule from "../../utils/panda";

type Panda = ReturnType<typeof PandaModule.default>;

const mock = vi.hoisted(() => {
  let instance: Panda | undefined;
  function current() {
    if (!instance) throw new Error("panda not initialized");
    return instance;
  }
  return {
    set(value: Panda) {
      instance = value;
    },
    panda: {
      businessApplication: (...parameters: Parameters<Panda["businessApplication"]>) =>
        current().businessApplication(...parameters),
      createCard: (...parameters: Parameters<Panda["createCard"]>) => current().createCard(...parameters),
      createCompanyApplication: (...parameters: Parameters<Panda["createCompanyApplication"]>) =>
        current().createCompanyApplication(...parameters),
      createUser: (...parameters: Parameters<Panda["createUser"]>) => current().createUser(...parameters),
      getApplicationStatus: (...parameters: Parameters<Panda["getApplicationStatus"]>) =>
        current().getApplicationStatus(...parameters),
      getCard: (...parameters: Parameters<Panda["getCard"]>) => current().getCard(...parameters),
      getCards: (...parameters: Parameters<Panda["getCards"]>) => current().getCards(...parameters),
      getCompanyUsers: (...parameters: Parameters<Panda["getCompanyUsers"]>) =>
        current().getCompanyUsers(...parameters),
      getCompanyStatus: (...parameters: Parameters<Panda["getCompanyStatus"]>) =>
        current().getCompanyStatus(...parameters),
      getNonce: (...parameters: Parameters<Panda["getNonce"]>) => current().getNonce(...parameters),
      getPIN: (...parameters: Parameters<Panda["getPIN"]>) => current().getPIN(...parameters),
      getProcessorDetails: (...parameters: Parameters<Panda["getProcessorDetails"]>) =>
        current().getProcessorDetails(...parameters),
      getSecrets: (...parameters: Parameters<Panda["getSecrets"]>) => current().getSecrets(...parameters),
      getUser: (...parameters: Parameters<Panda["getUser"]>) => current().getUser(...parameters),
      getWebhook: (...parameters: Parameters<Panda["getWebhook"]>) => current().getWebhook(...parameters),
      getWithdrawal: (...parameters: Parameters<Panda["getWithdrawal"]>) => current().getWithdrawal(...parameters),
      setPIN: (...parameters: Parameters<Panda["setPIN"]>) => current().setPIN(...parameters),
      submitApplication: (...parameters: Parameters<Panda["submitApplication"]>) =>
        current().submitApplication(...parameters),
      updateApplication: (...parameters: Parameters<Panda["updateApplication"]>) =>
        current().updateApplication(...parameters),
      updateCard: (...parameters: Parameters<Panda["updateCard"]>) => current().updateCard(...parameters),
      updateUser: (...parameters: Parameters<Panda["updateUser"]>) => current().updateUser(...parameters),
      verify: (...parameters: Parameters<Panda["verify"]>) => current().verify(...parameters),
      verifyPandaSignature: (...parameters: Parameters<Panda["verifyPandaSignature"]>) =>
        current().verifyPandaSignature(...parameters),
    },
  };
});
const { panda } = mock;

vi.mock("../../utils/panda", async (importOriginal) => {
  const module = await importOriginal<typeof PandaModule>();
  return {
    ...module,
    default: (...parameters: Parameters<typeof module.default>) => {
      mock.set(module.default(...parameters));
      return Object.assign(panda, {
        headerValidator: vValidator("header", object({ signature: string() }), (result, c) => {
          if (!result.success) return c.text("bad request", 400);
          return result.output.signature === "bad" ? c.text("unauthorized", 401) : undefined;
        }),
      });
    },
  };
});
