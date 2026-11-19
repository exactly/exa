import { decodeEventLog, formatUnits, padHex } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";

import { readContract } from "../anvil";
import { awaitLogs } from "../server";

declare const account: string | undefined;
declare const output: { deposited: number };

if (!account || !isHex(account)) throw new Error("bad account");

const log = awaitLogs({
  address: marketUSDCAddress,
  topics: [toEventSelector(getAbiItem({ abi: marketAbi, name: "Deposit" })), null, padHex(account)],
}).pop();
if (!log) throw new Error("no deposit");
output.deposited = Number(
  formatUnits(
    decodeEventLog({ abi: marketAbi, eventName: "Deposit", data: log.data, topics: log.topics }).args.assets,
    readContract({ address: marketUSDCAddress, functionName: "decimals", abi: marketAbi }),
  ),
);
