import chain from "@exactly/common/generated/chain";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { walletConnect as walletConnectType } from "@wagmi/connectors";
// @ts-expect-error deep import to avoid alien dependencies
import { walletConnect as walletConnectUntyped } from "@wagmi/connectors/dist/esm/walletConnect";
import { Platform } from "react-native";
import { http, type Chain } from "viem";
import * as chains from "viem/chains";
import { createConfig, createStorage, custom } from "wagmi";

import publicClient from "../publicClient";

const walletConnect = walletConnectUntyped as typeof walletConnectType;

export default createConfig({
  chains: Object.values(chains) as unknown as readonly [Chain, ...Chain[]],
  connectors: [walletConnect({ projectId: "d94854d116f9c1da5f21baf7421b7732", showQrModal: Platform.OS === "web" })],
  transports: {
    ...Object.fromEntries(Object.values(chains).map((c) => [c.id, http()])),
    [chain.id]: custom(publicClient),
  },
  storage: createStorage({ key: "wagmi.external", storage: AsyncStorage }),
});
