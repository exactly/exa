import { useMemo } from "react";

import { getAlchemyPaymasterAddress } from "@account-kit/infra";
import { useQuery } from "@tanstack/react-query";
import { waitForCallsStatus } from "@wagmi/core/actions";
import { encodeFunctionData, erc20Abi, getAddress, maxUint256, zeroAddress } from "viem";
import { useReadContract, useSendCalls } from "wagmi";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain from "@exactly/common/generated/chain";

import alchemyChainById from "./alchemyChains";
import { balancesOptions, bridgePolicyId, bridgePolicySymbols, gasReserveBuffer, lifiChainsOptions } from "./lifi";
import parseAmount from "./parseAmount";
import reportError from "./reportError";
import exa from "./wagmi/exa";

import type { TokenAmount } from "@lifi/sdk";
import type { Address } from "viem";

export default function useCrossChainGas({
  account,
  amount,
  chainId,
  networkCost,
  token,
  value,
}: {
  account: Address | undefined;
  amount: bigint;
  chainId: number;
  networkCost: bigint | undefined;
  token: null | TokenAmount | undefined;
  value?: bigint;
}) {
  const { data: balances } = useQuery(balancesOptions(account));
  const { data: chains } = useQuery(lifiChainsOptions);
  const nativeToken = chains?.find((item) => item.id === chainId)?.nativeToken;
  const sponsored = chainId === chain.id;
  const tokenAddress = token?.address ?? zeroAddress;
  const isNative = !!token && tokenAddress === zeroAddress;

  const nativeGasReserve = networkCost === undefined ? 0n : (networkCost * gasReserveBuffer) / 100n;
  const nativeBalance = balances?.[chainId]?.find(({ address }) => address === nativeToken?.address)?.amount;
  const nativeCovered =
    networkCost !== undefined && (value ?? (isNative ? amount : 0n)) + nativeGasReserve <= (nativeBalance ?? 0n);
  const gasToken = useMemo(() => {
    if (sponsored || isNative || !token) return;
    if (bridgePolicySymbols.has(token.symbol)) return token;
    return balances?.[chainId]?.find(
      (item) =>
        item.address !== nativeToken?.address &&
        bridgePolicySymbols.has(item.symbol) &&
        !!item.amount &&
        item.amount > 0n,
    );
  }, [balances, chainId, isNative, nativeToken?.address, sponsored, token]);
  const paymasterChain = alchemyChainById.get(chainId);
  const paymasterAddress = paymasterChain ? getAlchemyPaymasterAddress(paymasterChain, "0.6.0") : undefined;
  const erc20GasReserve = useMemo(() => {
    if (nativeGasReserve === 0n || !nativeToken || !gasToken) return 0n;
    const nativeUsd = parseAmount(nativeToken.priceUSD, 18);
    const tokenUsd = parseAmount(gasToken.priceUSD, 18);
    if (nativeUsd <= 0n || tokenUsd <= 0n) return 0n;
    return (
      (nativeGasReserve * nativeUsd * 10n ** BigInt(gasToken.decimals)) /
      (tokenUsd * 10n ** BigInt(nativeToken.decimals))
    );
  }, [gasToken, nativeGasReserve, nativeToken]);
  const feeIsSource = !!gasToken && gasToken.address.toLowerCase() === tokenAddress.toLowerCase();
  const paymasterFee =
    !nativeCovered &&
    gasToken &&
    paymasterAddress &&
    erc20GasReserve > 0n &&
    (feeIsSource ? amount + erc20GasReserve : erc20GasReserve) <= (gasToken.amount ?? 0n)
      ? gasToken
      : undefined;
  const insufficientGas =
    (!!balances && !!nativeToken && (value ?? 0n) > (nativeBalance ?? 0n)) ||
    (nativeGasReserve > 0n && !nativeCovered && !paymasterFee && (isNative || feeIsSource || !paymasterAddress));

  const { refetch: refetchPaymasterAllowance } = useReadContract({
    address: paymasterFee ? getAddress(paymasterFee.address) : undefined,
    chainId,
    abi: erc20Abi,
    functionName: "allowance",
    args: account && paymasterAddress ? [account, paymasterAddress] : undefined,
    query: { enabled: !!paymasterFee && !!account && !!paymasterAddress, staleTime: 0 },
  });

  const { mutateAsync: mutateSendCalls, data: submitted, reset: resetSendCalls } = useSendCalls();
  const sendCalls = async (calls: readonly { data?: `0x${string}`; to: `0x${string}`; value?: bigint }[]) => {
    const paymaster =
      paymasterFee && paymasterAddress
        ? { token: getAddress(paymasterFee.address), address: paymasterAddress }
        : undefined;
    const { data: allowance = 0n } = paymaster ? await refetchPaymasterAllowance() : { data: undefined };
    const approval =
      paymaster && allowance < erc20GasReserve
        ? (allowance > 0n ? [0n, maxUint256] : [maxUint256]).map((limit) => ({
            to: paymaster.token,
            data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [paymaster.address, limit] }),
          }))
        : [];
    const url = `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`;
    let id = submitted?.id;
    if (id === undefined) {
      try {
        ({ id } = await mutateSendCalls({
          chainId,
          calls: [...approval, ...calls],
          ...(sponsored
            ? { capabilities: { paymasterService: { url, context: { policyId: alchemyGasPolicyId } } } }
            : paymaster
              ? {
                  capabilities: {
                    paymasterService: {
                      optional: true,
                      url,
                      context: {
                        policyId: bridgePolicyId,
                        erc20Context: { tokenAddress: paymaster.token, maxTokenAmount: erc20GasReserve },
                      },
                    },
                  },
                }
              : nativeCovered
                ? {}
                : {
                    capabilities: {
                      paymasterService: { optional: true, url, context: { policyId: alchemyGasPolicyId } },
                    },
                  }),
        }));
      } catch (error) {
        if (!paymaster || reportError(error, { level: "warning" }).authKnown) throw error;
      }
    }
    let result = id === undefined ? undefined : await waitForCallsStatus(exa, { id });
    if (paymaster && result?.status !== "success") {
      ({ id } = await mutateSendCalls({
        chainId,
        calls,
        capabilities: { paymasterService: { optional: true, url, context: { policyId: alchemyGasPolicyId } } },
      }));
      result = await waitForCallsStatus(exa, { id });
    }
    resetSendCalls();
    if (result?.status !== "success") throw new Error("failed to send");
    return result.receipts?.[0];
  };

  return {
    erc20GasReserve,
    feeIsSource,
    gasToken,
    insufficientGas,
    nativeCovered,
    nativeGasReserve,
    paymasterAddress,
    paymasterFee,
    sendCalls,
    submitted,
  };
}
