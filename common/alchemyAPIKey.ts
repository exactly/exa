import { anvil, base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import chain from "./generated/chain";

const maybeKey =
  process.env.EXPO_PUBLIC_ALCHEMY_API_KEY || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  {
    [optimism.id]: "Wz728rhq_yGIAXdRmCy4VuKIAFjSmlpc", // cspell:ignore Wz728rhq_yGIAXdRmCy4VuKIAFjSmlpc
    [base.id]: "d_pBtamzsxX6zNEa5eQzT", // cspell:ignore d_pBtamzsxX6zNEa5eQzT
    [optimismSepolia.id]: "YrH_56532-d48Mnz1QUwAIMdgyqVYU4C", // cspell:ignore YrH_56532-d48Mnz1QUwAIMdgyqVYU4C
    [baseSepolia.id]: "YrH_56532-d48Mnz1QUwAIMdgyqVYU4C", // cspell:ignore YrH_56532-d48Mnz1QUwAIMdgyqVYU4C
    [anvil.id]: "",
  }[chain.id];
if (maybeKey === undefined) throw new Error("missing alchemy api key");
const alchemyAPIKey: string = maybeKey;

export default alchemyAPIKey;
