import { multicall3Abi, zeroAddress } from "viem";
import { useReadContracts } from "wagmi";

import chain, { previewerAbi, previewerAddress, ratePreviewerAddress } from "@exactly/common/generated/chain";
import { ratePreviewerAbi } from "@exactly/common/generated/hooks";
import MIN_BORROW_INTERVAL from "@exactly/common/MIN_BORROW_INTERVAL";
import { MATURITY_INTERVAL } from "@exactly/lib";

import useAccount from "./useAccount";

export default function useMarkets(query?: { enabled?: boolean; gcTime?: number; refetchInterval?: number }) {
  const { address: account } = useAccount();
  const { data, ...rest } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: previewerAddress, abi: previewerAbi, functionName: "exactly", args: [account ?? zeroAddress] },
      { address: ratePreviewerAddress, abi: ratePreviewerAbi, functionName: "snapshot" },
      { address: chain.contracts.multicall3.address, abi: multicall3Abi, functionName: "getCurrentBlockTimestamp" },
    ],
    query: { ...query, enabled: query?.enabled ?? true },
  });
  const timestamp = data?.[2] ?? BigInt(Math.floor(Date.now() / 1000));
  const now = Number(timestamp);
  const nextMaturity = now - (now % MATURITY_INTERVAL) + MATURITY_INTERVAL;
  return {
    ...rest,
    data,
    markets: data?.[0],
    rateSnapshot: data?.[1],
    timestamp,
    firstMaturity: nextMaturity - now < MIN_BORROW_INTERVAL ? nextMaturity + MATURITY_INTERVAL : nextMaturity,
  };
}
