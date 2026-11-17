import { useLocalSearchParams } from "expo-router";

import chain, { chains } from "@exactly/common/generated/chain";

export default function useNetwork() {
  const id = Number(useLocalSearchParams().chainId);
  return chains.has(id) ? id : chain.id;
}
