import AsyncStorage from "@react-native-async-storage/async-storage";

import * as infra from "@account-kit/infra";
import * as chains from "viem/chains";
import { createConfig, createStorage, custom, http } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

const others = Object.values(chains).filter((c) => c.id !== chain.id);

export default createConfig({
  chains: [chain, ...others],
  connectors: [alchemyConnector],
  transports: {
    ...Object.fromEntries(others.map((c) => [c.id, http()])),
    ...Object.values(infra).reduce<Record<number, ReturnType<typeof http>>>((result, item) => {
      if (typeof item !== "object" || !("id" in item) || !("rpcUrls" in item)) return result;
      const c = item as { id: number; rpcUrls: { alchemy?: { http?: readonly string[] } } };
      const url = c.rpcUrls.alchemy?.http?.[0];
      if (!url) return result;
      result[c.id] = http(`${url}/${alchemyAPIKey}`);
      return result;
    }, {}),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: `wagmi.exa.${chain.id}`, storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});
