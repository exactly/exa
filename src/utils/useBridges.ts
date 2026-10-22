import { useEffect } from "react";

import { useQueries, useQuery } from "@tanstack/react-query";

import decodeProposal from "./decodeProposal";
import executionOptions from "./executionOptions";
import { statusOptions, trackable } from "./lifi";
import queryClient from "./queryClient";
import reportError from "./reportError";
import useAccount from "./useAccount";

import type { Address, Hex, WalletCallReceipt } from "viem";

export default function useBridges() {
  const { address: account } = useAccount();
  const { data: bridges = [] } = useQuery<Bridge[]>({ queryKey: ["bridges", account], enabled: !!account });
  const proposed = bridges.filter(({ proposal }) => proposal);
  const executions = useQueries({
    queries: proposed.map(({ proposal }) => executionOptions(account, proposal?.nonce, proposal?.since)),
    combine: (results) => new Map(proposed.map(({ id }, index) => [id, results[index]?.data])),
  });
  const sent = bridges.flatMap((bridge) => {
    const hash = bridge.proposal ? executions.get(bridge.id)?.hash : bridge.id;
    return hash ? [{ ...bridge, hash }] : [];
  });
  const statuses = useQueries({
    queries: sent.map((bridge) =>
      statusOptions(bridge.hash, bridge.toChain, bridge.tool, bridge.fromChain, bridge.duration),
    ),
    combine: (results) => new Map(sent.map(({ id }, index) => [id, results[index]?.data?.status])),
  });
  const settled = bridges
    .filter(
      ({ id, timestamp, duration }) =>
        executions.get(id)?.executed === false ||
        statuses.get(id) === "DONE" ||
        statuses.get(id) === "FAILED" ||
        Date.now() > timestamp + Math.max(expiry, duration * 3000),
    )
    .map(({ id }) => id);
  useEffect(() => {
    const old = queryClient.getQueryData<Bridge[]>(["bridges", account]) ?? [];
    if (!old.some(({ id }) => settled.includes(id))) return;
    queryClient.setQueryData<Bridge[]>(
      ["bridges", account],
      old.filter(({ id }) => !settled.includes(id)),
    );
    queryClient.invalidateQueries({ queryKey: ["lifi", "balances"] }).catch(reportError);
  }, [account, settled]);
  return bridges.filter(({ id }) => !settled.includes(id));
}

export function track(
  account: Address,
  receipt: WalletCallReceipt<bigint, "reverted" | "success">,
  bridge: Omit<Bridge, "id" | "proposal" | "timestamp">,
) {
  if (!trackable) return;
  queryClient.setQueryData<Bridge[]>(["bridges", account], (old = []) => [
    ...old,
    { ...bridge, id: receipt.transactionHash, proposal: decodeProposal(receipt), timestamp: Date.now() },
  ]);
}

export type Bridge = {
  duration: number;
  fromChain: number;
  id: Hex;
  proposal?: { nonce: bigint; since: bigint };
  timestamp: number;
  toChain: number;
  tool?: string;
  toToken: { logoURI?: string; symbol: string };
};

const expiry = 2 * 60 * 60_000;
