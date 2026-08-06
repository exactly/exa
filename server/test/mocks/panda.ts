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
    default: (options: Parameters<typeof panda.default>[0]) => ({
      createUser: (user: Parameters<typeof panda.createUser>[0]) =>
        module.createUser(user, { key: options.key, url: options.url }),
      getUser: (id: string) => module.getUser(id, { key: options.key, url: options.url }),
      headerValidator: module.headerValidator(),
      signIssuerOp: (input: Parameters<typeof panda.signIssuerOp>[0]) => module.signIssuerOp(input, options.issuerKey),
      updateCard: (card: Parameters<typeof panda.updateCard>[0]) =>
        module.updateCard(card, { key: options.key, url: options.url }),
      updateUser: (user: Parameters<typeof panda.updateUser>[0]) =>
        module.updateUser(user, { key: options.key, url: options.url }),
      verifyPandaSignature: (input: Parameters<typeof panda.verifyPandaSignature>[0]) =>
        module.verifyPandaSignature(input, options.issuerAddress),
    }),
  });
});
