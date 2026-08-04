import { vValidator } from "@hono/valibot-validator";
import { object, string } from "valibot";
import { vi } from "vitest";

import type * as utils from "../../utils/panda";

vi.mock("../../utils/panda", async (importOriginal) => {
  const original = await importOriginal<typeof utils>();
  const panda = {
    ...original.default(),
    headerValidator: () =>
      vValidator("header", object({ signature: string() }), (r, c) => {
        if (!r.success) return c.text("bad request", 400);
        return r.output.signature === "bad" ? c.text("unauthorized", 401) : undefined;
      }),
  };
  const issuer = original.issuer();
  return { ...original, default: () => panda, issuer: () => issuer };
});
