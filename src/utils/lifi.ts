import chain, { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";
import { Hex } from "@exactly/common/validation";
import { getTokenBalancesByChain, getTokens, config, getContractCallsQuote } from "@lifi/sdk";
import { parse } from "valibot";
import { encodeFunctionData } from "viem";
import type { Address } from "viem";
import { optimism, optimismSepolia } from "viem/chains";

import publicClient from "./publicClient";

export async function getRoute(
  fromToken: Hex,
  toToken: Hex,
  toAmount: bigint,
  account: Hex,
  receiver: Hex,
  denyExchanges?: Record<string, boolean>,
) {
  if (chain.id === optimismSepolia.id) {
    const fromAmount = await publicClient.readContract({
      abi: mockSwapperAbi,
      functionName: "getAmountIn",
      address: parse(Hex, swapperAddress),
      args: [fromToken, toAmount, toToken],
    });
    return {
      exchange: "mockSwapper",
      fromAmount,
      data: parse(
        Hex,
        encodeFunctionData<typeof mockSwapperAbi>({
          abi: mockSwapperAbi,
          functionName: "swapExactAmountOut",
          args: [fromToken, fromAmount, toToken, toAmount, receiver],
        }),
      ),
    };
  }
  config.set({ integrator: "exa_app", userId: account });
  const { estimate, transactionRequest, tool } = await getContractCallsQuote({
    fee: 0.0025,
    slippage: 0.015,
    integrator: "exa_app",
    fromChain: optimism.id,
    toChain: optimism.id,
    fromToken: fromToken.toString(),
    toToken: toToken.toString(),
    toAmount: toAmount.toString(),
    fromAddress: account,
    contractCalls: [],
    toFallbackAddress: receiver,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  return { exchange: tool, fromAmount: BigInt(estimate.fromAmount), data: parse(Hex, transactionRequest?.data) };
}

export async function getAsset(account: Address) {
  const response = await getTokens({ chains: [optimism.id] });
  return response.tokens[optimism.id]?.find((token) => token.address === account);
}

export async function getTokenBalances(account: Address) {
  const response = await getTokens({ chains: [optimism.id] });
  const balances = await getTokenBalancesByChain(account, { [optimism.id]: response.tokens[optimism.id] ?? [] });
  return balances[optimism.id]?.filter((balance) => balance.amount && balance.amount > 0n) ?? [];
}
