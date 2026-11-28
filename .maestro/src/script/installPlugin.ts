import { encodeAbiParameters, encodeFunctionData, getAbiItem, keccak256 } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { isHex } from "viem/utils";

import {
  exaPluginAbi,
  mockPluginAddress as plugin,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (!plugin) throw new Error("no mock plugin");

anvil("anvil_impersonateAccount", [entryPoint06Address]);
const receipt = anvil("eth_sendTransactionSync", [
  {
    from: entryPoint06Address,
    to: account,
    data: encodeFunctionData({
      abi: upgradeableModularAccountAbi,
      functionName: "installPlugin",
      args: [
        plugin,
        keccak256(
          encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
            readContract({ address: plugin, functionName: "pluginManifest", abi: exaPluginAbi }),
          ]),
        ),
        "0x",
        [],
      ],
    }),
  },
]);
if (receipt.status !== "0x1") throw new Error(`reverted ${receipt.transactionHash}`);
if (
  readContract({ address: account, functionName: "getInstalledPlugins", abi: upgradeableModularAccountAbi })[0] !==
  plugin
) {
  throw new Error("mock plugin is not the newest installed plugin");
}
