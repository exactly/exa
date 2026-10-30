import { encodeAbiParameters, encodeFunctionData, getAbiItem, keccak256, padHex, type Address, type Hex } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { isHex, toEventSelector } from "viem/utils";

import { exaPluginAbi, exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const release = anvil("eth_getLogs", [
  {
    fromBlock: "0x0",
    topics: [toEventSelector(getAbiItem({ abi: exaPluginAbi, name: "PluginAllowed" })), padHex(exaPluginAddress)],
  },
])[0]?.address;
if (!release) throw new Error("no release");
send(exaPluginAddress, encodeFunctionData({ abi: exaPluginAbi, functionName: "allowPlugin", args: [release, true] }));

anvil("anvil_impersonateAccount", [entryPoint06Address]);
send(
  account,
  encodeFunctionData({
    abi: upgradeableModularAccountAbi,
    functionName: "executeBatch",
    args: [
      [
        {
          target: account,
          value: 0n,
          data: encodeFunctionData({
            abi: upgradeableModularAccountAbi,
            functionName: "uninstallPlugin",
            args: [
              exaPluginAddress,
              encodeAbiParameters(
                [
                  {
                    type: "tuple",
                    components: [
                      { name: "serializedManifest", type: "bytes" },
                      { name: "forceUninstall", type: "bool" },
                      { name: "callbackGasLimit", type: "uint256" },
                    ],
                  },
                ],
                [{ serializedManifest: "0x", forceUninstall: false, callbackGasLimit: 0n }],
              ),
              "0x",
            ],
          }),
        },
        {
          target: account,
          value: 0n,
          data: encodeFunctionData({
            abi: upgradeableModularAccountAbi,
            functionName: "installPlugin",
            args: [
              release,
              keccak256(
                encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
                  readContract({ address: release, functionName: "pluginManifest", abi: exaPluginAbi }),
                ]),
              ),
              "0x",
              [],
            ],
          }),
        },
      ],
    ],
  }),
  entryPoint06Address,
);

function send(to: Address, data: Hex, from?: Address) {
  const receipt = anvil("eth_sendTransactionSync", [{ from, to, data }]);
  if (receipt.status !== "0x1") throw new Error(`reverted ${receipt.transactionHash}`);
}
