import { decodeEventLog, erc20Abi, formatUnits, isAddressEqual, type Address, type Hex } from "viem";
import { getAbiItem, hexToNumber, isHex, numberToHex, parseUnits, toEventSelector } from "viem/utils";

import { mockSwapperAbi, swapperAddress } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity } from "../server";

declare const destination: string | undefined;
declare const after: string | undefined;
declare const network: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;

if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");
if (!after || !/^\d+$/.test(after)) throw new Error("bad after");

let started = latest(to);
for (const deadline = Date.now() + 30_000; !started; started = latest(to)) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for bridge");
}
let completed = completion(started.transactionId);
for (const deadline = Date.now() + 60_000; !completed; completed = completion(started.transactionId)) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for delivery");
}
const { hash, receivingAssetId, amount: delivered } = completed;
if (!isAddressEqual(completed.receiver, to)) throw new Error("bad receiver");
const decimals = readContract({ address: receivingAssetId, functionName: "decimals", abi: erc20Abi }, destination);
const expected = parseUnits(amount, decimals);
if (delivered < (expected * 98n) / 100n || delivered > (expected * 102n) / 100n) throw new Error("bad delivery");
activity(receivingAssetId, to, Number(formatUnits(delivered, decimals)), hash, destination);

function latest(account: Address) {
  if (hexToNumber(anvil("eth_blockNumber", [], network)) <= Number(after)) return;
  let found;
  for (const { data, topics } of anvil(
    "eth_getLogs",
    [
      {
        address: swapperAddress,
        fromBlock: numberToHex(Number(after) + 1),
        topics: [toEventSelector(getAbiItem({ abi: mockSwapperAbi, name: "LiFiTransferStarted" }))],
      },
    ],
    network,
  )) {
    const { bridgeData } = decodeEventLog({ abi: mockSwapperAbi, eventName: "LiFiTransferStarted", data, topics }).args;
    if (isAddressEqual(bridgeData.receiver, account)) found = bridgeData;
  }
  return found;
}

function completion(id: Hex) {
  const [log] = anvil(
    "eth_getLogs",
    [
      {
        address: swapperAddress,
        fromBlock: "0x0",
        topics: [toEventSelector(getAbiItem({ abi: mockSwapperAbi, name: "LiFiTransferCompleted" })), id],
      },
    ],
    destination,
  );
  if (!log) return;
  const { args } = decodeEventLog({ abi: mockSwapperAbi, eventName: "LiFiTransferCompleted", ...log });
  return { ...args, hash: log.transactionHash ?? undefined };
}
