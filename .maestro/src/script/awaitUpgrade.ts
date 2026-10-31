import { isHex } from "viem/utils";

import { exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

for (
  const deadline = Date.now() + 30_000;
  readContract({ address: account, functionName: "getInstalledPlugins", abi: upgradeableModularAccountAbi })[0] !==
  exaPluginAddress;
) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for upgrade");
}
