import { decodeEventLog, erc20Abi, formatUnits, hexToBigInt, hexToNumber } from "viem";
import { getAbiItem, isHex, parseUnits, toEventSelector } from "viem/utils";

import { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";

import anvil, { readContract, writeContract } from "../anvil";
import { activity } from "../server";

declare const destination: string | undefined;
declare const network: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;

if (!to) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

let log = bridge();
for (const deadline = Date.now() + 30_000; !log; log = bridge()) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for bridge");
}
const { transactionId, sendingAssetId, receiver, minAmount, destinationChainId } = decodeEventLog({
  abi: mockSwapperAbi,
  eventName: "LiFiTransferStarted",
  data: log.data,
  topics: log.topics,
}).args.bridgeData;
const nonEVM = destination
  ? (
      JSON.parse(http.get("http://localhost:3000/e2e/lifi/v1/chains").body) as {
        chains: { chainType: string; id: number; name: string }[];
      }
    ).chains.find(({ chainType, name }) => chainType !== "EVM" && name === destination)
  : undefined;
if (destinationChainId !== (nonEVM ? BigInt(nonEVM.id) : hexToBigInt(anvil("eth_chainId", [], destination)))) {
  throw new Error("bad destination");
}
const { tokens } = JSON.parse(http.get("http://localhost:3000/e2e/lifi/v1/tokens").body) as {
  tokens: Record<number, { address: string; decimals: number; symbol: string }[]>;
};
const source = tokens[hexToNumber(anvil("eth_chainId", [], network))]?.find(
  ({ address }) => address === sendingAssetId,
);
const token = tokens[Number(destinationChainId)]?.find(({ symbol }) =>
  nonEVM
    ? symbol === source?.symbol
    : (source?.symbol === "USDC.e" && symbol === "USDC") || (source?.symbol === "USDC" && symbol === "USDC.e"),
);
if (!token) throw new Error("bad token");
const expected = parseUnits(amount, token.decimals);
if (nonEVM) {
  const { status, toAddress } = JSON.parse(
    http.get(`http://localhost:3000/e2e/lifi/v1/status?txHash=${log.transactionHash}`).body,
  ) as { status: string; toAddress?: string };
  if (status !== "DONE" || toAddress !== to) throw new Error("bad receiver");
  if (minAmount < (expected * 98n) / 100n || minAmount > (expected * 102n) / 100n) throw new Error("bad amount");
} else {
  if (!isHex(to) || !isHex(token.address)) throw new Error("bad address");
  const balance = readContract(
    { address: token.address, functionName: "balanceOf", abi: erc20Abi, args: [to] },
    destination,
  );
  const hash = writeContract(
    {
      address: swapperAddress,
      functionName: "completeBridgeTokensViaMock",
      abi: mockSwapperAbi,
      args: [transactionId, token.address, receiver, minAmount],
    },
    destination,
  );
  const delivered =
    readContract({ address: token.address, functionName: "balanceOf", abi: erc20Abi, args: [to] }, destination) -
    balance;
  if (delivered < (expected * 98n) / 100n || delivered > (expected * 102n) / 100n) throw new Error("bad delivery");
  activity(token.address, to, Number(formatUnits(delivered, token.decimals)), hash, destination);
}

function bridge() {
  return anvil(
    "eth_getLogs",
    [
      {
        address: swapperAddress,
        fromBlock: "0x0",
        topics: [toEventSelector(getAbiItem({ abi: mockSwapperAbi, name: "LiFiTransferStarted" }))],
      },
    ],
    network,
  ).pop();
}
