import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

const alchemyAPIKeys: Readonly<Record<number, string | undefined>> = {
  [optimism.id]: "Wz728rhq_yGIAXdRmCy4VuKIAFjSmlpc", // cspell:ignore Wz728rhq_yGIAXdRmCy4VuKIAFjSmlpc
  [base.id]: "d_pBtamzsxX6zNEa5eQzT", // cspell:ignore d_pBtamzsxX6zNEa5eQzT
  [optimismSepolia.id]: "YrH_56532-d48Mnz1QUwAIMdgyqVYU4C", // cspell:ignore YrH_56532-d48Mnz1QUwAIMdgyqVYU4C
  [baseSepolia.id]: "YrH_56532-d48Mnz1QUwAIMdgyqVYU4C", // cspell:ignore YrH_56532-d48Mnz1QUwAIMdgyqVYU4C
};

export default alchemyAPIKeys;
