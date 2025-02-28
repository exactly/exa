import ProposalType from "@exactly/common/ProposalType";
import { Address } from "@exactly/common/validation";
import { WAD } from "@exactly/lib";
import { useQuery } from "@tanstack/react-query";
import React, { useCallback, useEffect } from "react";
import { parse } from "valibot";
import { encodeAbiParameters, erc20Abi, formatUnits, parseUnits, zeroAddress } from "viem";
import { useAccount, useSimulateContract, useWriteContract } from "wagmi";

import Failure from "./Failure";
import Pending from "./Pending";
import Review from "./Review";
import Success from "./Success";
import { useSimulateExaPluginPropose } from "../../generated/contracts";
import type { Withdraw as IWithdraw } from "../../utils/queryClient";
import queryClient from "../../utils/queryClient";
import useAsset from "../../utils/useAsset";
import SafeView from "../shared/SafeView";
import View from "../shared/View";

export interface WithdrawDetails {
  assetName?: string;
  amount: string;
  usdValue: string;
}

export default function Withdraw() {
  const { address } = useAccount();
  const { data: withdraw } = useQuery<IWithdraw>({ queryKey: ["withdrawal"] });
  const { market, externalAsset } = useAsset(withdraw?.market);

  const { data: proposeSimulation } = useSimulateExaPluginPropose({
    address,
    args: [
      market?.market ?? zeroAddress,
      withdraw?.amount ?? 0n,
      ProposalType.Withdraw,
      encodeAbiParameters([{ type: "address" }], [withdraw?.receiver ?? zeroAddress]),
    ],
    query: { enabled: !!withdraw && !!market && !!address },
  });

  const { data: transferSimulation } = useSimulateContract({
    address: externalAsset ? parse(Address, externalAsset.address) : zeroAddress,
    abi: erc20Abi,
    functionName: "transfer",
    args: [withdraw?.receiver ?? zeroAddress, withdraw?.amount ?? 0n],
    query: { enabled: !!withdraw && !!externalAsset && !!address },
  });

  const { writeContract, data: hash, isPending, isSuccess, isError, isIdle } = useWriteContract();

  const handleSubmit = useCallback(() => {
    if (market) {
      if (!proposeSimulation) throw new Error("no propose simulation");
      writeContract(proposeSimulation.request);
    } else {
      if (!externalAsset) throw new Error("no external asset");
      if (!transferSimulation) throw new Error("no transfer simulation");
      writeContract(transferSimulation.request);
    }
  }, [market, proposeSimulation, writeContract, externalAsset, transferSimulation]);

  const details: WithdrawDetails = {
    assetName: market ? (market.symbol.slice(3) === "WETH" ? "ETH" : market.symbol.slice(3)) : externalAsset?.symbol,
    amount: market
      ? formatUnits(withdraw?.amount ?? 0n, market.decimals)
      : formatUnits(withdraw?.amount ?? 0n, externalAsset?.decimals ?? 0),
    usdValue: market
      ? formatUnits(((withdraw?.amount ?? 0n) * market.usdPrice) / WAD, market.decimals)
      : formatUnits(
          ((withdraw?.amount ?? 0n) * parseUnits(externalAsset?.priceUSD ?? "0", 18)) / WAD,
          externalAsset?.decimals ?? 0,
        ),
  };

  const { data: recentContacts } = useQuery<{ address: Address; ens: string }[] | undefined>({
    queryKey: ["contacts", "recent"],
  });

  const canSend = market ? !!proposeSimulation : !!transferSimulation;
  const isFirstSend = !recentContacts?.some((contact) => contact.address === withdraw?.receiver);

  useEffect(() => {
    if (isSuccess) {
      queryClient.setQueryData<{ address: Address; ens: string }[] | undefined>(["contacts", "recent"], (old) =>
        [{ address: parse(Address, withdraw?.receiver), ens: "" }, ...(old ?? [])].slice(0, 3),
      );
    }
  }, [isSuccess, withdraw?.receiver]);

  return (
    <SafeView fullScreen>
      <View fullScreen>
        {isIdle && <Review onSend={handleSubmit} details={details} canSend={canSend} isFirstSend={isFirstSend} />}
        {isPending && <Pending details={details} hash={hash} />}
        {isSuccess && <Success details={details} hash={hash} />}
        {isError && <Failure details={details} hash={hash} />}
      </View>
    </SafeView>
  );
}
