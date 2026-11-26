import { getAbiItem, isHex, toFunctionSelector } from "viem/utils";

import { exaPluginAbi, exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

for (
  const deadline = Date.now() + 30_000;
  readContract({
    address: account,
    functionName: "getExecutionFunctionConfig",
    args: [toFunctionSelector(getAbiItem({ abi: exaPluginAbi, name: "collectDebit" }))],
    abi: upgradeableModularAccountAbi,
  }).plugin !== exaPluginAddress;
) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for upgrade");
}
