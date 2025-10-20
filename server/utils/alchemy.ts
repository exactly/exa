import chain from "@exactly/common/generated/chain";
import { validator } from "hono/validator";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

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

export const network =
  {
    [optimism.id]: "OPT_MAINNET" as const,
    [optimismSepolia.id]: "OPT_SEPOLIA" as const,
    [base.id]: "BASE_MAINNET" as const,
    [baseSepolia.id]: "BASE_SEPOLIA" as const,
  }[chain.id] ?? ("OPT_SEPOLIA" as const);
