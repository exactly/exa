import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

import type { ClientWithAlchemyMethods } from "@account-kit/infra";
import type { Chain } from "viem";

const clients = new Map<number, Promise<ClientWithAlchemyMethods>>();

export default function getPublicClient(target: Chain = chain): Promise<ClientWithAlchemyMethods> {
  let client = clients.get(target.id);
  if (!client) {
    client = (async () => {
      const { alchemy, createAlchemyPublicRpcClient } = await import("@account-kit/infra");
      const { http } = await import("viem");
      return createAlchemyPublicRpcClient({
        chain: target,
        transport: alchemyAPIKey ? alchemy({ apiKey: alchemyAPIKey }) : (http() as never),
      });
    })();
    clients.set(target.id, client);
  }
  return client;
}
