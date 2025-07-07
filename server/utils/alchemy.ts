import { validator } from "hono/validator";

import verifySignature from "./verifySignature";

if (!process.env.ALCHEMY_WEBHOOKS_KEY) throw new Error("missing alchemy webhooks key");
export const webhooksKey = process.env.ALCHEMY_WEBHOOKS_KEY;

export function headerValidator(signingKeys: Set<string> | (() => Set<string>)) {
  return validator("header", async ({ "x-alchemy-signature": signature }, c) => {
    for (const signingKey of typeof signingKeys === "function" ? signingKeys() : signingKeys) {
      const payload = await c.req.arrayBuffer();
      if (verifySignature({ signature, signingKey, payload })) return;
    }
    return c.json({ code: "unauthorized", legacy: "unauthorized" }, 401);
  });
}
