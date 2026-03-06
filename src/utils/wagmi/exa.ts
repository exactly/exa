import AsyncStorage from "@react-native-async-storage/async-storage";

import { createConfig, createStorage, custom } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain from "@exactly/common/generated/chain";

import alchemyConnector from "../alchemyConnector";
import publicClient from "../publicClient";

export default createConfig({
  chains: [chain],
  connectors: [alchemyConnector],
  transports: { [chain.id]: custom(publicClient) },
  storage: createStorage({ key: "wagmi.exa", storage: AsyncStorage }),
  multiInjectedProviderDiscovery: false,
});

export const capabilities = {
  paymasterService: {
    optional: true,
    url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
    context: { policyId: alchemyGasPolicyId },
  },
};
