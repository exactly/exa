import { decodeEventLog, formatUnits, padHex } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;
declare const output: { deposited: number };

if (!account || !isHex(account)) throw new Error("bad account");

const log = anvil("eth_getLogs", [
  {
    address: marketUSDCAddress,
    fromBlock: "0x0",
    topics: [toEventSelector(getAbiItem({ abi: marketAbi, name: "Deposit" })), null, padHex(account)],
  },
]).pop();
output.deposited = log
  ? Number(
      formatUnits(
        decodeEventLog({ abi: marketAbi, eventName: "Deposit", data: log.data, topics: log.topics }).args.assets,
        readContract({ address: marketUSDCAddress, functionName: "decimals", abi: marketAbi }),
      ),
    )
  : 0;
