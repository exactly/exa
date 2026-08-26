import {
  arbitrum,
  arbitrumSepolia,
  base,
  baseSepolia,
  bsc,
  inkMainnet,
  inkSepolia,
  mainnet,
  monadMainnet,
  optimism,
  optimismSepolia,
  polygon,
  sepolia,
  shape,
  shapeSepolia,
  soneiumMainnet,
  soneiumMinato,
  worldChain,
  worldChainSepolia,
} from "@account-kit/infra";
import { validator } from "hono/validator";
import {
  array,
  boolean,
  check,
  nonEmpty,
  number,
  object,
  optional,
  parse,
  picklist,
  pipe,
  string,
  type InferOutput,
} from "valibot";
import { withRetry, type Chain } from "viem";
import { anvil } from "viem/chains";

import chain from "@exactly/common/generated/chain";
import { Address } from "@exactly/common/validation";

import appOrigin from "./appOrigin";
import ServiceError from "./ServiceError";
import verifySignature from "./verifySignature";

export default function alchemy(key: string) {
  const headers = { "Content-Type": "application/json", "X-Alchemy-Token": parse(pipe(string(), nonEmpty()), key) };

  return {
    addWebhookAddresses,
    createWebhook,
    findWebhook,
    getWebhookAddresses,
    getWebhooks,
    headers,
    setWebhookActive,
  };

  async function getWebhooks() {
    return withRetry(
      async () => {
        const response = await fetch("https://dashboard.alchemy.com/api/team-webhooks", { headers });
        if (!response.ok) throw new ServiceError("Alchemy", response.status, await response.text());
        return parse(WebhooksResponse, await response.json()).data;
      },
      { retryCount: 10 },
    );
  }

  async function findWebhook(predicate: (webhook: Webhook) => unknown) {
    const webhooks = await getWebhooks();
    return webhooks.find((hook) => hook.is_active && hook.network === network() && predicate(hook));
  }

  async function createWebhook(
    options: (
      | { addresses: string[]; webhook_type: "ADDRESS_ACTIVITY" }
      | { graphql_query: { query: string; skip_empty_messages: true }; webhook_type: "GRAPHQL" }
    ) & { network?: string; webhook_url: string },
  ) {
    const create = await fetch("https://dashboard.alchemy.com/api/create-webhook", {
      headers,
      method: "POST",
      body: JSON.stringify({ ...options, network: options.network ?? network() }),
    });
    if (!create.ok) throw new ServiceError("Alchemy", create.status, await create.text());
    return parse(WebhookResponse, await create.json()).data;
  }

  async function addWebhookAddresses(id: string, addresses: Address[]) {
    if (addresses.length === 0) return;
    const update = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
      headers,
      method: "PATCH",
      body: JSON.stringify({ webhook_id: id, addresses_to_add: addresses, addresses_to_remove: [] }),
    });
    if (!update.ok) throw new ServiceError("Alchemy", update.status, await update.text());
  }

  async function getWebhookAddresses(id: string, after?: string) {
    const query = new URLSearchParams({ webhook_id: id, limit: "100" });
    if (after) query.set("after", after);
    const response = await fetch(`https://dashboard.alchemy.com/api/webhook-addresses?${String(query)}`, {
      headers,
    });
    if (!response.ok) throw new ServiceError("Alchemy", response.status, await response.text());
    return parse(WebhookAddressesResponse, await response.json());
  }

  async function setWebhookActive(id: string, isActive: boolean) {
    const response = await fetch("https://dashboard.alchemy.com/api/update-webhook", {
      headers,
      method: "PUT",
      body: JSON.stringify({ webhook_id: id, is_active: isActive }),
    });
    if (!response.ok) throw new ServiceError("Alchemy", response.status, await response.text());
  }
}

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

export const activityUrl = `${appOrigin}/hooks/activity`;

export function activityNetworks(id = chain.id) {
  if (id === anvil.id) {
    const current = NETWORKS.get("ANVIL");
    if (!current) throw new Error("missing anvil activity network");
    return new Map([["ANVIL", current]]);
  }
  const stack = [...NETWORKS.values()].find((current) => current.id === id);
  if (!stack) throw new Error("unsupported activity stack");
  return new Map(
    [...NETWORKS].filter(([name, current]) => name !== "ANVIL" && Boolean(current.testnet) === Boolean(stack.testnet)),
  );
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
export type Webhook = InferOutput<typeof Webhook>;

const WebhookResponse = object({ data: Webhook });
const WebhooksResponse = object({ data: array(Webhook) });
const WebhookAddressesResponse = object({
  data: array(Address),
  pagination: object({ cursors: object({ after: optional(string()) }), total_count: number() }),
});

export const NETWORKS = new Map<string, AlchemyChain>([
  ["ARB_MAINNET", arbitrum as AlchemyChain],
  ["ARB_SEPOLIA", arbitrumSepolia as AlchemyChain],
  ["BASE_MAINNET", base as AlchemyChain],
  ["BASE_SEPOLIA", baseSepolia as AlchemyChain],
  ["BNB_MAINNET", bsc as AlchemyChain],
  ["ETH_MAINNET", mainnet as AlchemyChain],
  ["ETH_SEPOLIA", sepolia as AlchemyChain],
  ["INK_MAINNET", inkMainnet as AlchemyChain],
  ["INK_SEPOLIA", inkSepolia as AlchemyChain],
  ["MATIC_MAINNET", polygon as AlchemyChain],
  ["MONAD_MAINNET", monadMainnet as AlchemyChain],
  ["OPT_MAINNET", optimism as AlchemyChain],
  ["OPT_SEPOLIA", optimismSepolia as AlchemyChain],
  ["SHAPE_MAINNET", shape as AlchemyChain],
  ["SHAPE_SEPOLIA", shapeSepolia as AlchemyChain],
  ["SONEIUM_MAINNET", soneiumMainnet as AlchemyChain], // cspell:ignore soneium
  ["SONEIUM_MINATO", soneiumMinato as AlchemyChain], // cspell:ignore minato
  ["WORLDCHAIN_MAINNET", worldChain as AlchemyChain], // cspell:ignore worldchain
  ["WORLDCHAIN_SEPOLIA", worldChainSepolia as AlchemyChain],
  ["ANVIL", { ...anvil, rpcUrls: { ...anvil.rpcUrls, alchemy: anvil.rpcUrls.default } } as AlchemyChain],
]);

type AlchemyChain = Chain & { rpcUrls: { alchemy: { http: readonly [string] } } };
