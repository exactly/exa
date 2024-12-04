import { optimism, optimismSepolia } from "viem/chains";

import chain from "./generated/chain";

const maybeKey =
  process.env.EXPO_PUBLIC_ALCHEMY_API_KEY || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  {
    [optimism.id]: "Wz728rhq_yGIAXdRmCy4VuKIAFjSmlpc",
    [optimismSepolia.id]: "YrH_56532-d48Mnz1QUwAIMdgyqVYU4C",
  }[chain.id];
if (!maybeKey) throw new Error("missing alchemy api key");
const alchemyAPIKey: string = maybeKey;

export default alchemyAPIKey;
