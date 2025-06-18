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

export async function getRouteFrom(
  fromToken: Hex,
  toToken: Hex,
  fromAmount: bigint,
  account: Hex,
  receiver: Hex,
  denyExchanges?: Record<string, boolean>,
) {
  config.set({ integrator: "exa_app", userId: account });
  const { estimate, transactionRequest, tool } = await getQuote({
    fee: 0.0025,
    slippage: 0.055,
    integrator: "exa_app",
    fromChain: optimism.id,
    toChain: optimism.id,
    fromToken: fromToken.toString(),
    toToken: toToken.toString(),
    fromAmount: fromAmount.toString(),
    fromAddress: account,
    toAddress: receiver,
    denyExchanges:
      denyExchanges &&
      Object.entries(denyExchanges)
        .filter(([_, value]) => value)
        .map(([key]) => key),
  });
  return { exchange: tool, toAmount: BigInt(estimate.toAmount), data: parse(Hex, transactionRequest?.data) };
}

export async function getTokenBalances(account: Address) {
  const tokens = await getAllTokens();
  const balances = await getTokenBalancesByChain(account, { [optimism.id]: tokens });
  return balances[optimism.id]?.filter((balance) => balance.amount && balance.amount > 0n) ?? [];
}

const allowList = new Set([
  "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  "0x4200000000000000000000000000000000000042",
  "0x4200000000000000000000000000000000000006",
  "0x68f180fcCe6836688e9084f035309E29Bf0A2095",
  "0x1F32b1c2345538c0c6f582fCB022739c4A194Ebb",
  "0x078f358208685046a11C85e8ad32895DED33A249",
  "0x0994206dfE8De6Ec6920FF4D779B0d950605Fb53",
  "0x14778860E937f509e651192a90589dE711Fb88a9",
  "0x191c10Aa4AF7C30e871E70C95dB0E4eb77237530",
  "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B",
  "0x23ee2343B892b1BB63503a4FAbc840E0e2C6810f",
  "0x350a791Bfc2C21F9Ed5d10980Dad2e2638ffa7f6",
  "0x513c7E3a9c69cA3e22550eF58AC1C0088e918FFf",
  "0x625E7708f30cA75bfd92586e17077590C60eb4cD",
  "0x6985884C4392D348587B19cb9eAAf157F13271cd",
  "0x6ab707Aca953eDAeFBc4fD23bA73294241490620",
  "0x6d80113e533a2C0fe82EaBD35f1875DcEA89Ea97",
  "0x6fd9d7AD17242c41f7131d257212c54A0e816691",
  "0x724dc807b04555b71ed48a6896b6F41593b8C637",
  "0x76FB31fb4af56892A25e32cFC43De717950c9278",
  "0x7FB688CCf682d58f86D7e38e03f9D22e7705448B",
  "0x82E64f49Ed5EC1bC6e43DAD4FC8Af9bb3A2312EE",
  "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4",
  "0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9",
  "0x8Eb270e296023E9D92081fdF967dDd7878724424",
  "0x920Cf626a271321C151D027030D5d08aF699456b",
  "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58",
  "0x9560e827aF36c94D2Ac33a39bCE1Fe78631088Db",
  "0x9Bcef72be871e61ED4fBbc7630889beE758eb81D",
  "0xadDb6A0412DE1BA0F936DCaeb8Aaa24578dcF3B2",
  "0xc40F949F8a4e094D1b49a23ea9241D289B7b2819",
  "0xc45A479877e1e9Dfe9FcD4056c699575a1045dAA",
  "0xc5102fE9359FD9a28f877a67E36B0F050d81a3CC",
  "0xC52D7F23a2e460248Db6eE192Cb23dD12bDDCbf6",
  "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
  "0xdC6fF44d5d932Cbd77B52E5612Ba0529DC6226F1",
  "0xe50fA9b3c56FfB159cB0FCA61F5c9D750e8128c8",
  "0xf329e36C7bF6E5E86ce2150875a84Ce77f477375",
  "0xFdb794692724153d1488CcdBE0C56c252596735F",
]);

export async function getAllowTokens() {
  const exa = await getToken(optimism.id, "0x1e925De1c68ef83bD98eE3E130eF14a50309C01B");
  const { tokens } = await getTokens({ chains: [optimism.id] });
  const allowTokens = tokens[optimism.id]?.filter((token) => allowList.has(token.address)) ?? [];
  return [exa, ...allowTokens];
}
