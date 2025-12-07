import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "./generated/chain";

export default process.env.EXPO_PUBLIC_ALCHEMY_GAS_POLICY_ID || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  {
    [optimism.id]: "cb9db554-658f-46eb-ae73-8bff8ed2556b",
    [base.id]: "ac4d73b4-5e7d-404d-b972-55c99f14f134",
    [optimismSepolia.id]: "dc767b7d-9ce8-4512-ba67-ebe2cf7a1577",
    [baseSepolia.id]: "dc767b7d-9ce8-4512-ba67-ebe2cf7a1577",
  }[chain.id];
