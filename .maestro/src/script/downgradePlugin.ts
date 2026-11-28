import { encodeAbiParameters, encodeFunctionData, getAbiItem, keccak256, padHex, sliceHex, zeroHash } from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { isHex, toEventSelector } from "viem/utils";

import { exaPluginAbi, exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

import anvil, { readContract, writeContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const release = anvil("eth_getLogs", [
  {
    fromBlock: "0x0",
    topics: [toEventSelector(getAbiItem({ abi: exaPluginAbi, name: "PluginAllowed" })), padHex(exaPluginAddress)],
  },
])[0]?.address;
if (!release) throw new Error("no release");
const admin = anvil("eth_getLogs", [
  {
    address: exaPluginAddress,
    fromBlock: "0x0",
    topics: [toEventSelector(getAbiItem({ abi: exaPluginAbi, name: "RoleGranted" })), zeroHash],
  },
])[0]?.topics[2];
if (!admin) throw new Error("no admin");

writeContract({
  address: exaPluginAddress,
  functionName: "allowPlugin",
  args: [release, true],
  abi: exaPluginAbi,
  from: sliceHex(admin, 12),
});
writeContract({
  address: account,
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
  abi: upgradeableModularAccountAbi,
  from: entryPoint06Address,
});
