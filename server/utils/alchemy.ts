import { validator } from "hono/validator";
import { array, boolean, nonEmpty, number, object, optional, parse, pipe, string, type InferOutput } from "valibot";
import { withRetry } from "viem";

import chain, { activityChains } from "@exactly/common/generated/chain";
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
    return webhooks.find((hook) => hook.is_active && hook.network === chain.alchemyNetwork && predicate(hook));
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
      body: JSON.stringify({ ...options, network: options.network ?? chain.alchemyNetwork }),
    });
    if (!create.ok) throw new ServiceError("Alchemy", create.status, await create.text());
    return parse(WebhookResponse, await create.json()).data;
  }

  async function addWebhookAddresses(id: string, addresses: Address[]) {
    if (addresses.length === 0) return;
    await withRetry(
      async () => {
        const update = await fetch("https://dashboard.alchemy.com/api/update-webhook-addresses", {
          headers,
          method: "PATCH",
          body: JSON.stringify({ webhook_id: id, addresses_to_add: addresses, addresses_to_remove: [] }),
        });
        if (!update.ok) throw new ServiceError("Alchemy", update.status, await update.text());
      },
      {
        delay: ({ count }) => Math.min(30_000, 1000 * 2 ** count),
        retryCount: 6,
        shouldRetry: ({ error }) => error instanceof ServiceError && (error.status === 429 || error.status >= 500),
      },
    );
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

export function activityChain(network: string) {
  return [...activityChains.values()].find(({ alchemyNetwork }) => alchemyNetwork === network);
}

export const activityUrl = `${appOrigin}/hooks/activity`;

const Webhook = object({
  id: string(),
  network: string(),
  webhook_type: string(),
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
