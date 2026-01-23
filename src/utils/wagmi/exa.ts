import AsyncStorage from "@react-native-async-storage/async-storage";

import { createConfig, createStorage, custom } from "wagmi";

import chain from "@exactly/common/generated/chain";

import alchemyConnector from "../alchemyConnector";
import getPublicClient from "../publicClient";

export default createConfig({
  chains: [chain],
  connectors: [alchemyConnector],
  transports: {
    [chain.id]: custom({
      async request(args) {
        const client = await getPublicClient(chain);
        return client.request(args as never);
      },
    }),
  },
  storage: createStorage({ key: "wagmi.exa", storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});
