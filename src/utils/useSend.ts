import { waitForCallsStatus } from "@wagmi/core/actions";
import { useSendCalls } from "wagmi";

import exa from "./wagmi/exa";

import type { Spend } from "./lifi";
import type { Address, Hex } from "viem";

export default function useSend(chainId: number, spend?: Spend) {
  const { mutateAsync, data: submitted, reset } = useSendCalls();
  async function sendCalls(calls: readonly { data?: Hex; to: Address; value?: bigint }[]) {
    const { id } = submitted ?? (await mutateAsync({ chainId, calls, capabilities: spend && { spend } }));
    const result = await waitForCallsStatus(exa, { id });
    reset();
    if (result.status !== "success") throw new Error("failed to send");
    return result.receipts?.[0];
  }
  return { sendCalls, submitted };
}
