import chain from "@exactly/common/generated/chain";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createConfig, createStorage, custom } from "wagmi";

import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

export default createConfig({
  chains: [chain],
  connectors: [alchemyConnector],
  transports: { [chain.id]: custom(publicClient) },
  storage: createStorage({ storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});
