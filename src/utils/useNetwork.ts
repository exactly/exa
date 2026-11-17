import { useLocalSearchParams } from "expo-router";

import chain, { networks } from "@exactly/common/generated/chain";

export default function useNetwork() {
  const id = Number(useLocalSearchParams().chainId);
  return networks.has(id) ? id : chain.id;
}
