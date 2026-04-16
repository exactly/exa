import * as chains from "@account-kit/infra";
import { validator } from "hono/validator";
import { array, boolean, check, object, parse, picklist, pipe, string, type InferOutput } from "valibot";
import { withRetry, type Chain } from "viem";
import { anvil } from "viem/chains";

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

export function network(id = chain.id) {
  return [...NETWORKS].find(([, current]) => current.id === id)?.[0] ?? "OPT_SEPOLIA";
}

export async function findWebhook(predicate: (webhook: Webhook) => unknown) {
  const webhooks = await withRetry(
    async () => {
      const response = await fetch("https://dashboard.alchemy.com/api/team-webhooks", { headers });
      if (!response.ok) throw new ServiceError("Alchemy", response.status, await response.text());
      return parse(WebhooksResponse, await response.json()).data;
    },
    { retryCount: 10 },
  );
  return webhooks.find((hook) => hook.is_active && hook.network === network() && predicate(hook));
}

export async function createWebhook(
  options: (
    | { addresses: string[]; webhook_type: "ADDRESS_ACTIVITY" }
    | { graphql_query: { query: string; skip_empty_messages: true }; webhook_type: "GRAPHQL" }
  ) & { network?: never; webhook_url: string },
) {
  const create = await fetch("https://dashboard.alchemy.com/api/create-webhook", {
    headers,
    method: "POST",
    body: JSON.stringify({ ...options, network: network() }),
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
  network: pipe(
    string(),
    check((input) => NETWORKS.has(input), "unsupported network"),
  ),
  webhook_type: picklist(["GRAPHQL", "ADDRESS_ACTIVITY"]),
  webhook_url: string(),
  signing_key: string(),
  is_active: boolean(),
});
type Webhook = InferOutput<typeof Webhook>;

const WebhookResponse = object({ data: Webhook });
const WebhooksResponse = object({ data: array(Webhook) });

export const NETWORKS = new Map<string, AlchemyChain>([
  ["ARB_MAINNET", chains.arbitrum as AlchemyChain],
  ["ARB_SEPOLIA", chains.arbitrumSepolia as AlchemyChain],
  ["BASE_MAINNET", chains.base as AlchemyChain],
  ["BASE_SEPOLIA", chains.baseSepolia as AlchemyChain],
  ["BNB_MAINNET", chains.bsc as AlchemyChain],
  ["ETH_MAINNET", chains.mainnet as AlchemyChain],
  ["ETH_SEPOLIA", chains.sepolia as AlchemyChain],
  ["INK_MAINNET", chains.inkMainnet as AlchemyChain],
  ["INK_SEPOLIA", chains.inkSepolia as AlchemyChain],
  ["MATIC_MAINNET", chains.polygon as AlchemyChain],
  ["MONAD_MAINNET", chains.monadMainnet as AlchemyChain],
  ["OPT_MAINNET", chains.optimism as AlchemyChain],
  ["OPT_SEPOLIA", chains.optimismSepolia as AlchemyChain],
  ["SHAPE_MAINNET", chains.shape as AlchemyChain],
  ["SHAPE_SEPOLIA", chains.shapeSepolia as AlchemyChain],
  ["SONEIUM_MAINNET", chains.soneiumMainnet as AlchemyChain], // cspell:ignore soneium
  ["SONEIUM_MINATO", chains.soneiumMinato as AlchemyChain], // cspell:ignore minato
  ["WORLDCHAIN_MAINNET", chains.worldChain as AlchemyChain], // cspell:ignore worldchain
  ["WORLDCHAIN_SEPOLIA", chains.worldChainSepolia as AlchemyChain],
  ["ANVIL", { ...anvil, rpcUrls: { ...anvil.rpcUrls, alchemy: anvil.rpcUrls.default } } as AlchemyChain],
]);

type AlchemyChain = Chain & { rpcUrls: { alchemy: { http: readonly [string] } } };
