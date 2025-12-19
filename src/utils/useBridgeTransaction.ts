import type { Token } from "@lifi/sdk";
import { useToastController } from "@tamagui/toast";
import { useMutation } from "@tanstack/react-query";
import { getWalletClient, switchChain, waitForTransactionReceipt } from "@wagmi/core";
import { useState } from "react";
import {
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  type Hex,
  zeroAddress,
  UserRejectedRequestError,
  TransactionExecutionError,
} from "viem";
import { waitForCallsStatus } from "viem/actions";
import { useReadContract, useSendCalls, useSendTransaction, useWriteContract, type Config } from "wagmi";

import type { RouteFrom } from "./lifi";
import queryClient from "./queryClient";
import reportError from "./reportError";

export default function useBridgeTransaction({
  senderAddress,
  senderConfig,
  account,
  selectedSource,
}: {
  senderAddress?: string;
  senderConfig: Config;
  account?: string;
  selectedSource?: { chain: number; address: string };
}) {
  const toast = useToastController();

  const [status, setStatus] = useState<string | undefined>();
  const [preview, setPreview] = useState<{ sourceToken: Token; sourceAmount: bigint } | undefined>();

  const { mutateAsync: sendTx } = useSendTransaction({ config: senderConfig });
  const { mutateAsync: sendCallsTx } = useSendCalls({ config: senderConfig });
  const { mutateAsync } = useWriteContract({ config: senderConfig });

  const { refetch: checkAllowance } = useReadContract({
    config: senderConfig,
    abi: erc20Abi,
    functionName: "allowance",
    query: { enabled: false },
  });

  const bridgeMutation = useMutation<unknown, unknown, RouteFrom>({
    mutationKey: ["bridge", "execute"],
    retry: false,
    mutationFn: async (route) => {
      if (!senderAddress || !selectedSource || !account) throw new Error("Missing context");

      setStatus(`Switching to Chain ${route.chainId}...`);
      await switchChain(senderConfig, { chainId: route.chainId });

      const spender = route.estimate.approvalAddress;
      const requiresApproval =
        !!spender &&
        spender !== zeroAddress &&
        selectedSource.address !== zeroAddress &&
        isAddress(spender) &&
        isAddress(selectedSource.address);

      let approvalData: Hex | undefined;

      if (requiresApproval) {
        setStatus("Checking allowance...");
        const { data: currentAllowance } = await checkAllowance();
        const requiredAmount = BigInt(route.estimate.fromAmount);

        if ((currentAllowance ?? 0n) < requiredAmount) {
          approvalData = encodeFunctionData({
            abi: erc20Abi,
            functionName: "approve",
            args: [getAddress(spender), requiredAmount],
          });
        }
      }

      setStatus("Submitting transaction...");
      const walletClient = await getWalletClient(senderConfig, { chainId: route.chainId });
      const { id } = await sendCallsTx({
        calls: [
          ...(approvalData ? [{ to: getAddress(selectedSource.address), data: approvalData }] : []),
          { to: getAddress(route.to), data: route.data, value: route.value },
        ],
        experimental_fallback: true,
      });
      setStatus("Waiting for confirmation...");
      await waitForCallsStatus(walletClient, { id, throwOnFailure: true });
    },
    onSuccess: () => {
      toast.show("Bridge transaction submitted", { native: true, preset: "done" });
      queryClient.invalidateQueries({ queryKey: ["bridge", "sources"] }).catch(reportError);
    },
    onError: (error) => {
      if (error instanceof UserRejectedRequestError) return;
      if (error instanceof TransactionExecutionError && error.shortMessage === "User rejected the request.") return;
      toast.show("Bridge failed", {
        native: true,
        preset: "error",
        burntOptions: { haptic: "error", preset: "error" },
      });
      reportError(error);
    },
    onSettled: () => setStatus(undefined),
  });

  const transferMutation = useMutation<
    unknown,
    unknown,
    { amount: bigint; request?: Parameters<typeof mutateAsync>[0]; isNative: boolean }
  >({
    mutationKey: ["bridge", "transfer"],
    retry: false,
    mutationFn: async ({ amount, request, isNative }) => {
      if (!senderAddress || !account) throw new Error("Missing context");

      setStatus("Transferring...");
      const recipient = getAddress(account);
      let hash: Hex;

      if (isNative) {
        hash = await sendTx({ to: recipient, value: amount });
      } else {
        if (!request) throw new Error("Simulation required");
        hash = await mutateAsync(request);
      }
      await waitForTransactionReceipt(senderConfig, { hash });
    },
    onSuccess: () => {
      toast.show("Transfer submitted", { native: true, preset: "done" });
      queryClient.invalidateQueries({ queryKey: ["bridge", "sources"] }).catch(reportError);
    },
    onError: (error) => {
      if (error instanceof UserRejectedRequestError) return;
      if (error instanceof TransactionExecutionError && error.shortMessage === "User rejected the request.") return;
      toast.show("Transfer failed", {
        native: true,
        preset: "error",
        burntOptions: { haptic: "error", preset: "error" },
      });
      reportError(error);
    },
    onSettled: () => setStatus(undefined),
  });

  const isPending = bridgeMutation.isPending || transferMutation.isPending;
  const isSuccess = bridgeMutation.isSuccess || transferMutation.isSuccess;
  const isError = bridgeMutation.isError || transferMutation.isError;

  const reset = () => {
    bridgeMutation.reset();
    transferMutation.reset();
    setPreview(undefined);
    setStatus(undefined);
  };

  return {
    executeBridge: bridgeMutation.mutateAsync,
    executeTransfer: transferMutation.mutateAsync,
    reset,
    setPreview,
    status,
    preview,
    isPending,
    isSuccess,
    isError,
  };
}
