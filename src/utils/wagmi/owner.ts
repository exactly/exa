import AsyncStorage from "@react-native-async-storage/async-storage";

import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { http } from "viem";
import * as chains from "viem/chains";
import { createConfig, createStorage, custom, injected } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import { dataSuffix } from "@exactly/common/attribution";
import chain, { alchemyChains } from "@exactly/common/generated/chain";

import publicClient from "../publicClient";

const config = createConfig({
  chains: [chain, ...Object.values(chains)],
  connectors: [miniAppConnector(), injected()],
  transports: {
    ...Object.fromEntries(Object.values(chains).map((c) => [c.id, http()])),
    ...Object.fromEntries(
      [...alchemyChains.values()].flatMap(({ id, rpcUrls }) =>
        rpcUrls.alchemy ? [[id, http(`${rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`)] as const] : [],
      ),
    ),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: `wagmi.owner.${chain.id}`, storage: AsyncStorage }),
  dataSuffix,
});
export default config;

export async function getConnector() {
  const miniApp = await sdk.isInMiniApp();
  const legacy = config.connectors.find((c) => c.id === "injected");
  const connector = miniApp
    ? config.connectors.find((c) => c.id === "farcaster")
    : (await legacy?.getProvider().catch(() => undefined))
      ? legacy
      : (config.connectors.find((c) => c.type === "injected" && c.id !== "injected") ?? legacy);
  if (!connector) throw new Error("no connector available");
  return connector;
}

export async function isAvailable() {
  const connector = await getConnector();
  if (connector.id === "injected") await connector.isAuthorized();
  const provider = await connector.getProvider({ chainId: chain.id });
  return provider !== undefined;
}
