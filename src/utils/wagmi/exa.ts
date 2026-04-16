import AsyncStorage from "@react-native-async-storage/async-storage";

import * as chains from "viem/chains";
import { createConfig, createStorage, custom, http } from "wagmi";

import chain from "@exactly/common/generated/chain";

import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

const others = Object.values(chains).filter((c) => c.id !== chain.id);

export default createConfig({
  chains: [chain, ...others],
  connectors: [alchemyConnector],
  transports: { ...Object.fromEntries(others.map((c) => [c.id, http()])), [chain.id]: custom(publicClient) },
  storage: createStorage({ key: "wagmi.exa", storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});
