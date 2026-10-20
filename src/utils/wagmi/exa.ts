import AsyncStorage from "@react-native-async-storage/async-storage";

import * as chains from "viem/chains";
import { createConfig, createStorage, custom, http } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import { dataSuffix } from "@exactly/common/attribution";
import chain, { alchemyChains } from "@exactly/common/generated/chain";

import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

const others = Object.values(chains).filter((c) => c.id !== chain.id);

export default createConfig({
  chains: [chain, ...others],
  connectors: [alchemyConnector],
  transports: {
    ...Object.fromEntries(others.map((c) => [c.id, http()])),
    ...Object.fromEntries(
      [...alchemyChains.values()].flatMap(({ id, rpcUrls }) =>
        rpcUrls.alchemy ? [[id, http(`${rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`)] as const] : [],
      ),
    ),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: `wagmi.exa.${chain.id}`, storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
  dataSuffix,
});
