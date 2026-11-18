import { useId, useState } from "react";

import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";
import { useSendCalls } from "wagmi";

import queryClient from "./queryClient";
import exa from "./wagmi/exa";
import waitForCalls from "./waitForCalls";

import type { Spend } from "./lifi";
import type { Address, Hex } from "viem";

export default function useSend(chainId: number, { key, spend }: { key?: readonly unknown[]; spend?: Spend } = {}) {
  const mountId = useId();
  const queryKey = ["send", chainId, ...(key ?? [mountId])];
  const { data: submitted } = useQuery<null | string>({ queryKey, queryFn: skipToken });
  const [bundle, setBundle] = useState(submitted);
  if (submitted && submitted !== bundle) setBundle(submitted);
  const status = useQuery(statusOptions(bundle));
  const { mutateAsync } = useSendCalls();
  async function sendCalls(calls: readonly { data?: Hex; to: Address; value?: bigint }[]) {
    let id = queryClient.getQueryData<null | string>(queryKey);
    if (!id) {
      ({ id } = await mutateAsync({ chainId, calls, capabilities: spend && { spend } }));
      queryClient.setQueryData(queryKey, id);
    }
    const result = await queryClient.fetchQuery(statusOptions(id));
    if (result.status !== "success") throw new Error("failed to send");
    return result.receipts?.[0];
  }
  return { sendCalls, submitted, status, queryKey };
}

function statusOptions(id?: null | string) {
  return queryOptions({
    queryKey: ["send", "status", id],
    queryFn: id
      ? async () => {
          const result = await waitForCalls(exa, id);
          queryClient.setQueriesData({ queryKey: ["send"], predicate: ({ state }) => state.data === id }, null);
          return result;
        }
      : skipToken,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
}
