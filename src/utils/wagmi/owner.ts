import AsyncStorage from "@react-native-async-storage/async-storage";

import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { http } from "viem";
import * as chains from "viem/chains";
import { createConfig, createStorage, custom, injected } from "wagmi";

import chain from "@exactly/common/generated/chain";

import publicClient from "../publicClient";

const config = createConfig({
  chains: [chain, ...Object.values(chains)],
  connectors: [miniAppConnector(), injected()],
  transports: {
    ...Object.fromEntries(Object.values(chains).map((c) => [c.id, http()])),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: "wagmi.owner", storage: AsyncStorage }),
});
export default config;

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
