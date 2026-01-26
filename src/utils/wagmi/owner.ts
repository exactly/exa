import AsyncStorage from "@react-native-async-storage/async-storage";

import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createClient, http, type Chain } from "viem";
import { createConfig, createStorage, custom, injected } from "wagmi";

import chain from "@exactly/common/generated/chain";

import publicClient from "../publicClient";

const config = createConfig({
  chains: [chain],
  connectors: [miniAppConnector(), injected()],
  client({ chain: c }) {
    return createClient({ chain: c, transport: c.id === chain.id ? custom(publicClient) : http() });
  },
  storage: createStorage({ key: "wagmi.owner", storage: AsyncStorage }),
});
export default config;

export function addChains(newChains: readonly Chain[]) {
  const current = config.chains;
  const ids = new Set(current.map((c) => c.id));
  const toAdd = newChains.filter((c) => !ids.has(c.id));
  if (toAdd.length === 0) return;
  config._internal.chains.setState([...current, ...toAdd]);
}

export async function getConnector() {
  const miniApp = await sdk.isInMiniApp();
  const connector = miniApp
    ? config.connectors.find((c) => c.id === "farcaster")
    : config.connectors.find((c) => c.id === "injected");
  if (!connector) throw new Error("no connector available");
  return connector;
}

export async function isAvailable() {
  const connector = await getConnector();
  if (connector.id === "injected") await connector.isAuthorized();
  const provider = await connector.getProvider({ chainId: chain.id });
  return provider !== undefined;
}
