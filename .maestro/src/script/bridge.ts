import { decodeEventLog, erc20Abi, formatUnits, hexToBigInt, hexToNumber, type Address } from "viem";
import { getAbiItem, isHex, parseUnits, toEventSelector } from "viem/utils";

import { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";

import anvil, { readContract, writeContract } from "../anvil";
import { activity } from "../server";

declare const destination: string | undefined;
declare const network: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;

if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const log = anvil(
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
if (!log) throw new Error("missing bridge");
const { transactionId, sendingAssetId, receiver, minAmount, destinationChainId } = decodeEventLog({
  abi: mockSwapperAbi,
  eventName: "LiFiTransferStarted",
  data: log.data,
  topics: log.topics,
}).args.bridgeData;
if (destinationChainId !== hexToBigInt(anvil("eth_chainId", [], destination))) throw new Error("bad destination");
const { tokens } = JSON.parse(http.get("http://localhost:3000/e2e/lifi/v1/tokens").body) as {
  tokens: Record<number, { address: Address; symbol: string }[]>;
};
const source = tokens[hexToNumber(anvil("eth_chainId", [], network))]?.find(
  ({ address }) => address === sendingAssetId,
);
const token = tokens[Number(destinationChainId)]?.find(
  ({ symbol }) =>
    (source?.symbol === "USDC.e" && symbol === "USDC") || (source?.symbol === "USDC" && symbol === "USDC.e"),
)?.address;
if (!token) throw new Error("bad token");
const decimals = readContract({ address: token, functionName: "decimals", abi: erc20Abi }, destination);
const balance = readContract({ address: token, functionName: "balanceOf", abi: erc20Abi, args: [to] }, destination);
const hash = writeContract(
  {
    address: swapperAddress,
    functionName: "completeBridgeTokensViaMock",
    abi: mockSwapperAbi,
    args: [transactionId, token, receiver, minAmount],
  },
  destination,
);
const delivered =
  readContract({ address: token, functionName: "balanceOf", abi: erc20Abi, args: [to] }, destination) - balance;
const expected = parseUnits(amount, decimals);
if (delivered < (expected * 98n) / 100n || delivered > (expected * 102n) / 100n) throw new Error("bad delivery");
activity(token, to, Number(formatUnits(delivered, decimals)), hash, destination);
