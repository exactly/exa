import { queryOptions } from "@tanstack/react-query";
import { getBytecode } from "@wagmi/core/actions";
import { hexToNumber, keccak256, size, slice } from "viem";

import exaConfig from "./wagmi/exa";

export default function create3Options(chainId: number) {
  return queryOptions({
    queryKey: ["create3", chainId],
    queryFn: async () => {
      const code = await getBytecode(exaConfig, { address: "0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1", chainId });
      if (!code || size(code) < 2) return false;
      const end = size(code) - 2 - hexToNumber(slice(code, -2));
      return (
        end > 0 &&
        [
          "0xbfe9a955c841340d9e3e860811f708654f99c0d3522c0d14ee6e27543bf402e8",
          "0x5b329dc605cf85bc7506be37515d0fc8288a543a1d5bf54e40f92aa6f1470563",
        ].includes(keccak256(slice(code, 0, end)))
      );
    },
    staleTime: (query) => (query.state.data ? Infinity : 0),
    gcTime: Infinity,
    retry: false,
    meta: { dropError: () => true },
  });
}
