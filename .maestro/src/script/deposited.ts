import { decodeEventLog, formatUnits, padHex } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { marketAbi, marketUSDCAddress, marketWETHAddress } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;
declare const market: string | undefined;
declare const network: string | undefined;
declare const output: { deposited: number };

if (!account || !isHex(account)) throw new Error("bad account");
const address = new Map([
  ["USDC", marketUSDCAddress],
  ["WETH", marketWETHAddress],
]).get(market ?? "USDC");
if (!address) throw new Error("bad market");

const log = anvil(
  "eth_getLogs",
  [
    {
      address,
      fromBlock: "0x0",
      topics: [toEventSelector(getAbiItem({ abi: marketAbi, name: "Deposit" })), null, padHex(account)],
    },
  ],
  network,
).pop();
output.deposited = log
  ? Number(
      formatUnits(
        decodeEventLog({ abi: marketAbi, eventName: "Deposit", data: log.data, topics: log.topics }).args.assets,
        readContract({ address, functionName: "decimals", abi: marketAbi }, network),
      ),
    )
  : 0;
