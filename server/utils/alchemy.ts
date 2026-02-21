import { validator } from "hono/validator";
import { array, boolean, object, parse, picklist, string, type InferOutput } from "valibot";
import { withRetry } from "viem";
import { anvil, base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "@exactly/common/generated/chain";

import ServiceError from "./ServiceError";
import verifySignature from "./verifySignature";

import type { Address } from "@exactly/common/validation";

if (!process.env.ALCHEMY_WEBHOOKS_KEY) throw new Error("missing alchemy webhooks key");
export const headers = { "Content-Type": "application/json", "X-Alchemy-Token": process.env.ALCHEMY_WEBHOOKS_KEY };

export function headerValidator(signingKeys: (() => Set<string>) | Set<string>) {
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
    [anvil.id]: "ANVIL" as const,
  }[chain.id] ?? ("OPT_SEPOLIA" as const);

export async function findWebhook(predicate: (webhook: Webhook) => unknown) {
  const webhooks = await withRetry(
    async () => {
      const response = await fetch("https://dashboard.alchemy.com/api/team-webhooks", { headers });
      if (!response.ok) throw new ServiceError("Alchemy", response.status, await response.text());
      return parse(WebhooksResponse, await response.json()).data;
    },
    { retryCount: 10 },
  );
  return webhooks.find((hook) => hook.is_active && hook.network === network && predicate(hook));
}

export async function createWebhook(
  options: { network?: never; webhook_url: string } & (
    | { addresses: string[]; webhook_type: "ADDRESS_ACTIVITY" }
    | { graphql_query: { query: string; skip_empty_messages: true }; webhook_type: "GRAPHQL" }
  ),
) {
  const create = await fetch("https://dashboard.alchemy.com/api/create-webhook", {
    headers,
    method: "POST",
    body: JSON.stringify({ ...options, network }),
  });
  if (!create.ok) throw new ServiceError("Alchemy", create.status, await create.text());
  return parse(WebhookResponse, await create.json()).data;
}

export async function updateWebhookAddresses(id: string | undefined, add: Address[], remove: Address[] = []) {
  if (!id) return;
  const update = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
    headers,
    method: "PATCH",
    body: JSON.stringify({ webhook_id: id, addresses_to_add: add, addresses_to_remove: remove }),
  });
  if (!update.ok) throw new ServiceError("Alchemy", update.status, await update.text());
}

const Webhook = object({
  id: string(),
  network: picklist(["OPT_MAINNET", "OPT_SEPOLIA", "BASE_MAINNET", "BASE_SEPOLIA"]),
  webhook_type: picklist(["GRAPHQL", "ADDRESS_ACTIVITY"]),
  webhook_url: string(),
  signing_key: string(),
  is_active: boolean(),
});
type Webhook = InferOutput<typeof Webhook>;

const WebhookResponse = object({ data: Webhook });
const WebhooksResponse = object({ data: array(Webhook) });
