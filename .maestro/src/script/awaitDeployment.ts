import { padHex } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { exaAccountFactoryAbi } from "@exactly/common/generated/chain";

import { awaitLogs } from "../server";

declare const account: string | undefined;
declare const network: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

awaitLogs(
  {
    topics: [
      toEventSelector(getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" })),
      padHex(account),
    ],
  },
  network,
);
