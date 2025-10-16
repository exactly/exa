import chain from "@exactly/common/generated/chain";
import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createConfig, createStorage, custom, injected } from "wagmi";

import publicClient from "../publicClient";

const config = createConfig({
  chains: [chain],
  connectors: [miniAppConnector(), injected()],
  transports: { [chain.id]: custom(publicClient) },
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
