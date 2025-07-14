import chain, { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";
import { Hex } from "@exactly/common/validation";
import { config, getQuote, getToken, getTokenBalancesByChain, getTokens, type Token } from "@lifi/sdk";
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
  const { estimate, transactionRequest, tool } = await getQuote({
    fee: 0.0025,
    slippage: 0.015,
    integrator: "exa_app",
    fromChain: optimism.id,
    toChain: optimism.id,
    fromToken: fromToken.toString(),
    toToken: toToken.toString(),
    toAmount: toAmount.toString(),
    fromAddress: account,
    toAddress: receiver,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  return { exchange: tool, fromAmount: BigInt(estimate.fromAmount), data: parse(Hex, transactionRequest?.data) };
}

async function getAllTokens(): Promise<Token[]> {
  const response = await getTokens({ chains: [optimism.id] });
  const exa = await getToken(optimism.id, "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B");
  return [exa, ...(response.tokens[optimism.id] ?? [])];
}

export async function getAsset(account: Address) {
  const tokens = await getAllTokens();
  return tokens.find((token) => token.address === account);
}

export async function getTokenBalances(account: Address) {
  const tokens = await getAllTokens();
  const balances = await getTokenBalancesByChain(account, { [optimism.id]: tokens });
  return balances[optimism.id]?.filter((balance) => balance.amount && balance.amount > 0n) ?? [];
}
