import { useId } from "react";

import { skipToken, useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { useSendCalls } from "wagmi";

import queryClient from "./queryClient";
import exa from "./wagmi/exa";

import type { Spend } from "./lifi";
import type { Address, Hex } from "viem";

export default function useSend(chainId: number, { key, spend }: { key?: readonly unknown[]; spend?: Spend } = {}) {
  const mountId = useId();
  const queryKey = ["send", chainId, ...(key ?? [mountId])];
  const { data: submitted } = useQuery<null | string>({ queryKey, queryFn: skipToken });
  const { mutateAsync } = useSendCalls();
  async function sendCalls(calls: readonly { data?: Hex; to: Address; value?: bigint }[]) {
    let id = queryClient.getQueryData<null | string>(queryKey);
    if (!id) {
      ({ id } = await mutateAsync({ chainId, calls, capabilities: spend && { spend } }));
      queryClient.setQueryData(queryKey, id);
    }
    const result = await waitForCallsStatus(exa, { id });
    queryClient.setQueryData(queryKey, null);
    if (result.status !== "success") throw new Error("failed to send");
    return result.receipts?.[0];
  }
  return { sendCalls, submitted };
}
