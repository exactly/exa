import {
  decodeEventLog,
  erc20Abi,
  formatUnits,
  hexToBigInt,
  hexToNumber,
  isAddressEqual,
  slice,
  toHex,
  type Address,
  type Hex,
} from "viem";
import { getAbiItem, isHex, parseUnits, toEventSelector } from "viem/utils";

import { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";

import anvil, { readContract, writeContract } from "../anvil";
import { activity, awaitLogs } from "../server";

declare const destination: string | undefined;
declare const network: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;
declare const output: { bridged: number };

if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const {
  bridgeData: { transactionId, sendingAssetId, minAmount, destinationChainId, hasSourceSwaps },
  transactionHash,
} = bridge(to);
if (destinationChainId !== hexToBigInt(anvil("eth_chainId", [], destination))) throw new Error("bad destination");
const { tokens } = JSON.parse(http.get("http://localhost:3000/e2e/lifi/v1/tokens").body) as {
  tokens: Record<number, { address: Address; decimals: number; priceUSD: string; symbol: string }[]>;
};
const sourceTokens = tokens[hexToNumber(anvil("eth_chainId", [], network))] ?? [];
const source = sourceTokens.find(({ address }) => address === sendingAssetId);
const destinationToken = tokens[Number(destinationChainId)]?.find(
  ({ symbol }) =>
    (source?.symbol === "USDC.e" && symbol === "USDC") || (source?.symbol === "USDC" && symbol === "USDC.e"),
);
if (!source || !destinationToken) throw new Error("bad token");
const token = destinationToken.address;
const decimals = readContract({ address: token, functionName: "decimals", abi: erc20Abi }, destination);
const balance = readContract({ address: token, functionName: "balanceOf", abi: erc20Abi, args: [to] }, destination);
const hash = writeContract(
  {
    address: swapperAddress,
    functionName: "completeBridgeTokensViaMock",
    abi: mockSwapperAbi,
    args: [transactionId, token, to, minAmount],
  },
  destination,
);
const delivered =
  readContract({ address: token, functionName: "balanceOf", abi: erc20Abi, args: [to] }, destination) - balance;
const expected = parseUnits(amount, decimals);
if (delivered < (expected * 98n) / 100n || delivered > (expected * 102n) / 100n) throw new Error("bad delivery");
activity(token, to, Number(formatUnits(delivered, decimals)), hash, destination);
const paid = hasSourceSwaps ? sourceSwap() : { amount: minAmount, asset: source };
output.bridged =
  Number(formatUnits(delivered, decimals)) * Number(destinationToken.priceUSD) -
  Number(formatUnits(paid.amount, paid.asset.decimals)) * Number(paid.asset.priceUSD);

function sourceSwap() {
  if (!transactionHash) throw new Error("bad transfer");
  const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }));
  const transfers = (anvil("eth_getTransactionReceipt", [transactionHash], network)?.logs ?? []).flatMap(
    ({ address, data, topics }) =>
      topics[0] === transfer && topics[1] && topics[2]
        ? [{ address, amount: BigInt(data), from: slice(topics[1], 12), to: slice(topics[2], 12) }]
        : [],
  );
  const pool = transfers.find(
    ({ address, to: receiver }) => isAddressEqual(address, sendingAssetId) && isAddressEqual(receiver, swapperAddress),
  )?.from;
  const input = transfers.find(
    ({ address, to: receiver }) => pool && !isAddressEqual(address, sendingAssetId) && isAddressEqual(receiver, pool),
  );
  const asset = input && sourceTokens.find(({ address }) => isAddressEqual(address, input.address));
  if (!input || !asset) throw new Error("bad source swap");
  return { amount: input.amount, asset };
}

function bridge(account: Address) {
  const started = toEventSelector(getAbiItem({ abi: mockSwapperAbi, name: "LiFiTransferStarted" }));
  const deadline = Date.now() + 30_000;
  for (let fromBlock: Hex = "0x0"; ; ) {
    const timeout = deadline - Date.now();
    if (timeout <= 0) throw new Error("timeout waiting for bridge");
    const found = awaitLogs({ address: swapperAddress, fromBlock, timeout, topics: [started] }, network);
    let latest;
    for (const { data, topics, transactionHash: startedHash } of found) {
      const { bridgeData } = decodeEventLog({
        abi: mockSwapperAbi,
        eventName: "LiFiTransferStarted",
        data,
        topics,
      }).args;
      if (isAddressEqual(bridgeData.receiver, account)) latest = { bridgeData, transactionHash: startedHash };
    }
    if (
      latest &&
      !readContract(
        {
          address: swapperAddress,
          functionName: "completed",
          abi: mockSwapperAbi,
          args: [latest.bridgeData.transactionId],
        },
        destination,
      )
    ) {
      return latest;
    }
    fromBlock = toHex(Math.max(...found.map(({ blockNumber }) => hexToNumber(blockNumber ?? "0x0"))) + 1);
  }
}
