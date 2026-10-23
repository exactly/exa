import {
  encodeAbiParameters,
  encodeDeployData,
  encodeFunctionData,
  getAbiItem,
  isAddressEqual,
  keccak256,
  type Address,
  type Hex,
} from "viem";
import { entryPoint06Address } from "viem/account-abstraction";
import { isHex } from "viem/utils";

import { exaPluginAbi, exaPluginAddress, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";
import { bytecode } from "@exactly/plugin/out/build/ExaPlugin.sol/ExaPlugin.json";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const [admin] = anvil("eth_accounts", []);
if (!admin) throw new Error("no admin");
const read = (
  functionName:
    | "AUDITOR"
    | "collector"
    | "DEBT_MANAGER"
    | "EXA_USDC"
    | "EXA_WETH"
    | "flashLoaner"
    | "INSTALLMENTS_ROUTER"
    | "ISSUER_CHECKER"
    | "proposalManager"
    | "swapper",
) => readContract({ address: exaPluginAddress, functionName, abi: exaPluginAbi });
const { contractAddress: previous } = send(
  admin,
  undefined,
  encodeDeployData({
    abi: exaPluginAbi,
    bytecode: bytecode.object as Hex,
    args: [
      {
        owner: admin,
        auditor: read("AUDITOR"),
        exaUSDC: read("EXA_USDC"),
        exaWETH: read("EXA_WETH"),
        flashLoaner: read("flashLoaner"),
        debtManager: read("DEBT_MANAGER"),
        installmentsRouter: read("INSTALLMENTS_ROUTER"),
        issuerChecker: read("ISSUER_CHECKER"),
        proposalManager: read("proposalManager"),
        collector: read("collector"),
        swapper: read("swapper"),
        firstKeeper: admin,
      },
    ],
  }),
);
if (!previous) throw new Error("no previous plugin");
send(
  admin,
  exaPluginAddress,
  encodeFunctionData({ abi: exaPluginAbi, functionName: "allowPlugin", args: [previous, true] }),
);
send(
  admin,
  previous,
  encodeFunctionData({ abi: exaPluginAbi, functionName: "allowPlugin", args: [exaPluginAddress, true] }),
);

anvil("anvil_impersonateAccount", [entryPoint06Address]);
send(
  entryPoint06Address,
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
              previous,
              keccak256(
                encodeAbiParameters(getAbiItem({ abi: exaPluginAbi, name: "pluginManifest" }).outputs, [
                  readContract({ address: previous, functionName: "pluginManifest", abi: exaPluginAbi }),
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
);
anvil("anvil_stopImpersonatingAccount", [entryPoint06Address]);

const [installed] = readContract({
  address: account,
  functionName: "getInstalledPlugins",
  abi: upgradeableModularAccountAbi,
});
if (!installed || !isAddressEqual(installed, previous))
  throw new Error(`expected plugin ${previous}, got ${installed}`);

function send(from: Address, to: Address | undefined, data: Hex) {
  const receipt = anvil("eth_sendTransactionSync", [{ from, to, data }]);
  if (receipt.status !== "0x1") throw new Error(`reverted ${receipt.transactionHash}`);
  return receipt;
}
