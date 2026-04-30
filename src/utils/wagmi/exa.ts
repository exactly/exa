import AsyncStorage from "@react-native-async-storage/async-storage";

import * as chains from "viem/chains";
import { createConfig, createStorage, custom, http } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

import alchemyChainById from "../alchemyChains";
import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

const others = Object.values(chains).filter((c) => c.id !== chain.id);

export default createConfig({
  chains: [chain, ...others],
  connectors: [alchemyConnector],
  transports: {
    ...Object.fromEntries(
      others.map((c) => [
        c.id,
        http(alchemyChainById.get(c.id)?.rpcUrls.alchemy?.http[0]?.concat(`/${alchemyAPIKey}`)),
      ]),
    ),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: `wagmi.exa.${chain.id}`, storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});
