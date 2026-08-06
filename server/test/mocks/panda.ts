import { vValidator } from "@hono/valibot-validator";
import { object, string } from "valibot";
import { vi } from "vitest";

import type * as Panda from "../../utils/panda";

vi.mock("../../utils/panda", async (importOriginal) => {
  const panda = await importOriginal<typeof Panda>();
  const module = {
    ...panda,
    headerValidator: () => {
      return vValidator("header", object({ signature: string() }), (r, c) => {
        if (!r.success) return c.text("bad request", 400);
        return r.output.signature === "bad" ? c.text("unauthorized", 401) : undefined;
      });
    },
  };
  return Object.assign(module, {
    default: () => ({
      createCard: (userId: string, productId: Parameters<typeof panda.createCard>[1], amount?: number) =>
        module.createCard(userId, productId, amount),
      createUser: (user: Parameters<typeof panda.createUser>[0]) => module.createUser(user),
      getApplicationStatus: (applicationId: string) => module.getApplicationStatus(applicationId),
      getCard: (cardId: string) => module.getCard(cardId),
      getCards: (userId: string) => module.getCards(userId),
      getNonce: (userId: string) => module.getNonce(userId),
      getPIN: (cardId: string, sessionId: string) => module.getPIN(cardId, sessionId),
      getProcessorDetails: (cardId: string) => module.getProcessorDetails(cardId),
      getSecrets: (cardId: string, sessionId: string) => module.getSecrets(cardId, sessionId),
      getUser: (id: string) => module.getUser(id),
      headerValidator: module.headerValidator(),
      setPIN: (cardId: string, sessionId: string, pin: Parameters<typeof panda.setPIN>[2]) =>
        module.setPIN(cardId, sessionId, pin),
      signIssuerOp: (input: Parameters<typeof panda.signIssuerOp>[0]) => module.signIssuerOp(input),
      submitApplication: (payload: Parameters<typeof panda.submitApplication>[0]) => module.submitApplication(payload),
      updateApplication: (applicationId: string, payload: Parameters<typeof panda.updateApplication>[1]) =>
        module.updateApplication(applicationId, payload),
      updateCard: (card: Parameters<typeof panda.updateCard>[0]) => module.updateCard(card),
      updateUser: (user: Parameters<typeof panda.updateUser>[0]) => module.updateUser(user),
      verify: (userId: string, payload: Parameters<typeof panda.verify>[1]) => module.verify(userId, payload),
      verifyPandaSignature: (input: Parameters<typeof panda.verifyPandaSignature>[0]) =>
        module.verifyPandaSignature(input),
    }),
  });
});
