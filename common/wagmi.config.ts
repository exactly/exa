import { defineConfig, type Plugin } from "@wagmi/cli";
import { foundry, foundryDefaultExcludes, react } from "@wagmi/cli/plugins";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import {
  encodeAbiParameters,
  encodePacked,
  erc20Abi,
  getAddress,
  getContractAddress,
  getCreate2Address,
  keccak256,
  type Abi,
} from "viem";
import { anvil, base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import ExaPluginOptimismBroadcast from "@exactly/plugin/broadcast/ExaPlugin.s.sol/10/run-latest.json" with { type: "json" };
import ExaPluginOpSepoliaBroadcast from "@exactly/plugin/broadcast/ExaPlugin.s.sol/11155420/run-latest.json" with { type: "json" };
import ExaPluginBaseSepoliaBroadcast from "@exactly/plugin/broadcast/ExaPlugin.s.sol/84532/run-latest.json" with { type: "json" };
import ExaPluginBaseBroadcast from "@exactly/plugin/broadcast/ExaPlugin.s.sol/8453/run-latest.json" with { type: "json" };
import ExaPreviewerOptimismBroadcast from "@exactly/plugin/broadcast/ExaPreviewer.s.sol/10/run-latest.json" with { type: "json" };
import ExaPreviewerOpSepoliaBroadcast from "@exactly/plugin/broadcast/ExaPreviewer.s.sol/11155420/run-latest.json" with { type: "json" };
import ExaPreviewerBaseSepoliaBroadcast from "@exactly/plugin/broadcast/ExaPreviewer.s.sol/84532/run-latest.json" with { type: "json" };
import ExaPreviewerBaseBroadcast from "@exactly/plugin/broadcast/ExaPreviewer.s.sol/8453/run-latest.json" with { type: "json" };
import IssuerCheckerOptimismBroadcast from "@exactly/plugin/broadcast/IssuerChecker.s.sol/10/run-latest.json" with { type: "json" };
import IssuerCheckerOpSepoliaBroadcast from "@exactly/plugin/broadcast/IssuerChecker.s.sol/11155420/run-latest.json" with { type: "json" };
import IssuerCheckerBaseSepoliaBroadcast from "@exactly/plugin/broadcast/IssuerChecker.s.sol/84532/run-latest.json" with { type: "json" };
import IssuerCheckerBaseBroadcast from "@exactly/plugin/broadcast/IssuerChecker.s.sol/8453/run-latest.json" with { type: "json" };
import ProposalManagerOptimismBroadcast from "@exactly/plugin/broadcast/ProposalManager.s.sol/10/run-latest.json" with { type: "json" };
import ProposalManagerOpSepoliaBroadcast from "@exactly/plugin/broadcast/ProposalManager.s.sol/11155420/run-latest.json" with { type: "json" };
import ProposalManagerBaseSepoliaBroadcast from "@exactly/plugin/broadcast/ProposalManager.s.sol/84532/run-latest.json" with { type: "json" };
import ProposalManagerBaseBroadcast from "@exactly/plugin/broadcast/ProposalManager.s.sol/8453/run-latest.json" with { type: "json" };
import RefunderOptimismBroadcast from "@exactly/plugin/broadcast/Refunder.s.sol/10/run-latest.json" with { type: "json" };
import RefunderOpSepoliaBroadcast from "@exactly/plugin/broadcast/Refunder.s.sol/11155420/run-latest.json" with { type: "json" };
import RefunderBaseSepoliaBroadcast from "@exactly/plugin/broadcast/Refunder.s.sol/84532/run-latest.json" with { type: "json" };
import RefunderBaseBroadcast from "@exactly/plugin/broadcast/Refunder.s.sol/8453/run-latest.json" with { type: "json" };
import deploy from "@exactly/plugin/deploy.json" with { type: "json" };
import ExaAccountFactoryArtifact from "@exactly/plugin/out/ExaAccountFactory.sol/ExaAccountFactory.json" with { type: "json" };
import ExaPluginArtifact from "@exactly/plugin/out/ExaPlugin.sol/ExaPlugin.json" with { type: "json" };
import ExaPreviewerArtifact from "@exactly/plugin/out/ExaPreviewer.sol/ExaPreviewer.json" with { type: "json" };
import IssuerCheckerArtifact from "@exactly/plugin/out/IssuerChecker.sol/IssuerChecker.json" with { type: "json" };
import MockSwapperArtifact from "@exactly/plugin/out/MockSwapper.sol/MockSwapper.json" with { type: "json" };
import ProposalManagerArtifact from "@exactly/plugin/out/ProposalManager.sol/ProposalManager.json" with { type: "json" };
import RefunderArtifact from "@exactly/plugin/out/Refunder.sol/Refunder.json" with { type: "json" };
import Auditor from "@exactly/protocol/deployments/base/Auditor.json" with { type: "json" };
import Balancer3VaultBase from "@exactly/protocol/deployments/base/Balancer3Vault.json" with { type: "json" };
import Firewall from "@exactly/protocol/deployments/base/Firewall.json" with { type: "json" };
import FlashLoanAdapter from "@exactly/protocol/deployments/base/FlashLoanAdapter.json" with { type: "json" };
import IntegrationPreviewer from "@exactly/protocol/deployments/base/IntegrationPreviewer.json" with { type: "json" };
import MarketUSDCBase from "@exactly/protocol/deployments/base/MarketUSDC.json" with { type: "json" };
import Market from "@exactly/protocol/deployments/base/MarketWETH.json" with { type: "json" };
import Previewer from "@exactly/protocol/deployments/base/Previewer.json" with { type: "json" };
import RatePreviewer from "@exactly/protocol/deployments/base/RatePreviewer.json" with { type: "json" };
import USDCBase from "@exactly/protocol/deployments/base/USDC.json" with { type: "json" };
import WETHBase from "@exactly/protocol/deployments/base/WETH.json" with { type: "json" };
import AuditorBaseSepolia from "@exactly/protocol/deployments/base-sepolia/Auditor.json" with { type: "json" };
import Balancer2VaultBaseSepolia from "@exactly/protocol/deployments/base-sepolia/Balancer2Vault.json" with { type: "json" };
import FirewallBaseSepolia from "@exactly/protocol/deployments/base-sepolia/Firewall.json" with { type: "json" };
import IntegrationPreviewerBaseSepolia from "@exactly/protocol/deployments/base-sepolia/IntegrationPreviewer.json" with { type: "json" };
import MarketUSDCBaseSepolia from "@exactly/protocol/deployments/base-sepolia/MarketUSDC.json" with { type: "json" };
import MarketWETHBaseSepolia from "@exactly/protocol/deployments/base-sepolia/MarketWETH.json" with { type: "json" };
import PreviewerBaseSepolia from "@exactly/protocol/deployments/base-sepolia/Previewer.json" with { type: "json" };
import RatePreviewerBaseSepolia from "@exactly/protocol/deployments/base-sepolia/RatePreviewer.json" with { type: "json" };
import USDCBaseSepolia from "@exactly/protocol/deployments/base-sepolia/USDC.json" with { type: "json" };
import WETHBaseSepolia from "@exactly/protocol/deployments/base-sepolia/WETH.json" with { type: "json" };
import AuditorOpSepolia from "@exactly/protocol/deployments/op-sepolia/Auditor.json" with { type: "json" };
import Balancer2VaultOpSepolia from "@exactly/protocol/deployments/op-sepolia/Balancer2Vault.json" with { type: "json" };
import IntegrationPreviewerOpSepolia from "@exactly/protocol/deployments/op-sepolia/IntegrationPreviewer.json" with { type: "json" };
import MarketUSDCOpSepolia from "@exactly/protocol/deployments/op-sepolia/MarketUSDC.json" with { type: "json" };
import MarketWETHOpSepolia from "@exactly/protocol/deployments/op-sepolia/MarketWETH.json" with { type: "json" };
import PreviewerOpSepolia from "@exactly/protocol/deployments/op-sepolia/Previewer.json" with { type: "json" };
import RatePreviewerOpSepolia from "@exactly/protocol/deployments/op-sepolia/RatePreviewer.json" with { type: "json" };
import USDCOpSepolia from "@exactly/protocol/deployments/op-sepolia/USDC.json" with { type: "json" };
import WETHOpSepolia from "@exactly/protocol/deployments/op-sepolia/WETH.json" with { type: "json" };
import AuditorOptimism from "@exactly/protocol/deployments/optimism/Auditor.json" with { type: "json" };
import Balancer2VaultOptimism from "@exactly/protocol/deployments/optimism/Balancer2Vault.json" with { type: "json" };
import IntegrationPreviewerOptimism from "@exactly/protocol/deployments/optimism/IntegrationPreviewer.json" with { type: "json" };
import MarketUSDCOptimism from "@exactly/protocol/deployments/optimism/MarketUSDC.json" with { type: "json" };
import MarketWETHOptimism from "@exactly/protocol/deployments/optimism/MarketWETH.json" with { type: "json" };
import PreviewerOptimism from "@exactly/protocol/deployments/optimism/Previewer.json" with { type: "json" };
import RatePreviewerOptimism from "@exactly/protocol/deployments/optimism/RatePreviewer.json" with { type: "json" };
import USDCOptimism from "@exactly/protocol/deployments/optimism/USDC.json" with { type: "json" };
import WETHOptimism from "@exactly/protocol/deployments/optimism/WETH.json" with { type: "json" };

const PLUGIN_BROADCASTS = {
  ExaPlugin: {
    [optimism.id]: ExaPluginOptimismBroadcast,
    [optimismSepolia.id]: ExaPluginOpSepoliaBroadcast,
    [base.id]: ExaPluginBaseBroadcast,
    [baseSepolia.id]: ExaPluginBaseSepoliaBroadcast,
  },
  ExaPreviewer: {
    [optimism.id]: ExaPreviewerOptimismBroadcast,
    [optimismSepolia.id]: ExaPreviewerOpSepoliaBroadcast,
    [base.id]: ExaPreviewerBaseBroadcast,
    [baseSepolia.id]: ExaPreviewerBaseSepoliaBroadcast,
  },
  ProposalManager: {
    [optimism.id]: ProposalManagerOptimismBroadcast,
    [optimismSepolia.id]: ProposalManagerOpSepoliaBroadcast,
    [base.id]: ProposalManagerBaseBroadcast,
    [baseSepolia.id]: ProposalManagerBaseSepoliaBroadcast,
  },
  IssuerChecker: {
    [optimism.id]: IssuerCheckerOptimismBroadcast,
    [optimismSepolia.id]: IssuerCheckerOpSepoliaBroadcast,
    [base.id]: IssuerCheckerBaseBroadcast,
    [baseSepolia.id]: IssuerCheckerBaseSepoliaBroadcast,
  },
  Refunder: {
    [optimism.id]: RefunderOptimismBroadcast,
    [optimismSepolia.id]: RefunderOpSepoliaBroadcast,
    [base.id]: RefunderBaseBroadcast,
    [baseSepolia.id]: RefunderBaseSepoliaBroadcast,
  },
} as const satisfies Record<string, Record<number, { transactions: { contractAddress: string }[] }>>;

const chainId = Number(env.CHAIN_ID ?? String(env.EAS_BUILD_RUNNER === "eas-build" ? optimism.id : optimismSepolia.id));

function pluginAddresses(contract: keyof typeof PLUGIN_BROADCASTS) {
  const result: Record<number, `0x${string}`> = {};
  for (const [id, broadcast] of Object.entries(PLUGIN_BROADCASTS[contract])) {
    result[Number(id)] = getAddress(broadcast.transactions[0]?.contractAddress ?? "");
  }
  if (chainId === anvil.id) {
    result[anvil.id] = getAddress(loadBroadcast(contract).transactions[0]?.contractAddress ?? "");
  }
  return result;
}

const auditor = loadDeployment("Auditor");
const marketUSDC = loadDeployment("MarketUSDC");
const marketWETH = loadDeployment("MarketWETH");
const integrationPreviewer = loadDeployment("IntegrationPreviewer");
const previewer = loadDeployment("Previewer");
const ratePreviewer = loadDeployment("RatePreviewer");
const usdc = loadDeployment("USDC");
const weth = loadDeployment("WETH");
const firewall = loadDeployment("Firewall", false);
const balancerVault = loadDeployment("Balancer2Vault", false);
const flashLoanAdapter = loadDeployment("FlashLoanAdapter", false);
const [exaPlugin] = loadBroadcast("ExaPlugin").transactions;
const [issuerChecker] = loadBroadcast("IssuerChecker").transactions;
const [proposalManager] = loadBroadcast("ProposalManager").transactions;
const [refunder] = loadBroadcast("Refunder").transactions;
const [exaPreviewer] = loadBroadcast("ExaPreviewer").transactions;
const swapper = (deploy.accounts.swapper as Record<string, string>)[chainId] ?? deploy.accounts.swapper.default;
if (!exaPlugin || !issuerChecker || !proposalManager || !exaPreviewer || !refunder || !swapper) {
  throw new Error("missing contracts");
}

export default defineConfig([
  {
    out: "generated/hooks.ts",
    contracts: [
      {
        name: "Auditor",
        abi: Auditor.abi as Abi,
        address: {
          [optimism.id]: getAddress(AuditorOptimism.address),
          [optimismSepolia.id]: getAddress(AuditorOpSepolia.address),
          [base.id]: getAddress(Auditor.address),
          [baseSepolia.id]: getAddress(AuditorBaseSepolia.address),
        },
      },
      {
        name: "IntegrationPreviewer",
        abi: IntegrationPreviewer.abi as Abi,
        address: {
          [optimism.id]: getAddress(IntegrationPreviewerOptimism.address),
          [optimismSepolia.id]: getAddress(IntegrationPreviewerOpSepolia.address),
          [base.id]: getAddress(IntegrationPreviewer.address),
          [baseSepolia.id]: getAddress(IntegrationPreviewerBaseSepolia.address),
        },
      },
      {
        name: "FlashLoanAdapter",
        abi: FlashLoanAdapter.abi as Abi,
        address: { [base.id]: getAddress(FlashLoanAdapter.address) },
      },
      { name: "Market", abi: Market.abi as Abi },
      {
        name: "MarketUSDC",
        abi: Market.abi as Abi,
        address: {
          [optimism.id]: getAddress(MarketUSDCOptimism.address),
          [optimismSepolia.id]: getAddress(MarketUSDCOpSepolia.address),
          [base.id]: getAddress(MarketUSDCBase.address),
          [baseSepolia.id]: getAddress(MarketUSDCBaseSepolia.address),
        },
      },
      {
        name: "MarketWETH",
        abi: Market.abi as Abi,
        address: {
          [optimism.id]: getAddress(MarketWETHOptimism.address),
          [optimismSepolia.id]: getAddress(MarketWETHOpSepolia.address),
          [base.id]: getAddress(Market.address),
          [baseSepolia.id]: getAddress(MarketWETHBaseSepolia.address),
        },
      },
      {
        name: "Previewer",
        abi: Previewer.abi as Abi,
        address: {
          [optimism.id]: getAddress(PreviewerOptimism.address),
          [optimismSepolia.id]: getAddress(PreviewerOpSepolia.address),
          [base.id]: getAddress(Previewer.address),
          [baseSepolia.id]: getAddress(PreviewerBaseSepolia.address),
        },
      },
      {
        name: "RatePreviewer",
        abi: RatePreviewer.abi as Abi,
        address: {
          [optimism.id]: getAddress(RatePreviewerOptimism.address),
          [optimismSepolia.id]: getAddress(RatePreviewerOpSepolia.address),
          [base.id]: getAddress(RatePreviewer.address),
          [baseSepolia.id]: getAddress(RatePreviewerBaseSepolia.address),
        },
      },
      {
        name: "USDC",
        abi: erc20Abi,
        address: {
          [optimism.id]: getAddress(USDCOptimism.address),
          [optimismSepolia.id]: getAddress(USDCOpSepolia.address),
          [base.id]: getAddress(USDCBase.address),
          [baseSepolia.id]: getAddress(USDCBaseSepolia.address),
        },
      },
      {
        name: "WETH",
        abi: erc20Abi,
        address: {
          [optimism.id]: getAddress(WETHOptimism.address),
          [optimismSepolia.id]: getAddress(WETHOpSepolia.address),
          [base.id]: getAddress(WETHBase.address),
          [baseSepolia.id]: getAddress(WETHBaseSepolia.address),
        },
      },
      { name: "ExaPlugin", abi: ExaPluginArtifact.abi as Abi, address: pluginAddresses("ExaPlugin") },
      { name: "ExaPreviewer", abi: ExaPreviewerArtifact.abi as Abi, address: pluginAddresses("ExaPreviewer") },
      { name: "ProposalManager", abi: ProposalManagerArtifact.abi as Abi, address: pluginAddresses("ProposalManager") },
      { name: "IssuerChecker", abi: IssuerCheckerArtifact.abi as Abi, address: pluginAddresses("IssuerChecker") },
      { name: "Refunder", abi: RefunderArtifact.abi as Abi, address: pluginAddresses("Refunder") },
      {
        name: "ExaAccountFactory",
        abi: ExaAccountFactoryArtifact.abi as Abi,
        address: {
          [anvil.id]: exaAccountFactoryAddress(anvil.id),
          [optimism.id]: exaAccountFactoryAddress(optimism.id),
          [optimismSepolia.id]: exaAccountFactoryAddress(optimismSepolia.id),
          [base.id]: exaAccountFactoryAddress(base.id),
          [baseSepolia.id]: exaAccountFactoryAddress(baseSepolia.id),
        },
      },
      {
        name: "Swapper",
        abi: MockSwapperArtifact.abi as Abi,
        address: {
          [optimism.id]: getAddress(deploy.accounts.swapper.default),
          [optimismSepolia.id]: getAddress(deploy.accounts.swapper["11155420"]),
          [base.id]: getAddress(deploy.accounts.swapper.default),
          [baseSepolia.id]: getAddress(deploy.accounts.swapper["84532"]),
        },
      },
      {
        name: "Firewall",
        abi: Firewall.abi as Abi,
        address: {
          [base.id]: getAddress(Firewall.address),
          [baseSepolia.id]: getAddress(FirewallBaseSepolia.address),
        },
      },
      {
        name: "Balancer2Vault",
        abi: [] as unknown as Abi,
        address: {
          [optimism.id]: getAddress(Balancer2VaultOptimism.address),
          [optimismSepolia.id]: getAddress(Balancer2VaultOpSepolia.address),
          [baseSepolia.id]: getAddress(Balancer2VaultBaseSepolia.address),
        },
      },
      {
        name: "Balancer3Vault",
        abi: [] as unknown as Abi,
        address: { [base.id]: getAddress(Balancer3VaultBase.address) },
      },
    ],
    plugins: [
      foundry({
        forge: { build: false },
        project: "../contracts",
        include: ["UpgradeableModularAccount.sol/UpgradeableModularAccount.json"],
      }),
      react(),
    ],
  },
  {
    out: "generated/chain.ts",
    contracts: [
      { name: "Auditor", abi: Auditor.abi as Abi },
      { name: "Firewall", abi: Firewall.abi as Abi },
      { name: "Market", abi: Market.abi as Abi },
      { name: "Previewer", abi: Previewer.abi as Abi },
    ],
    plugins: [
      addresses(
        {
          auditor: auditor.address,
          exaPlugin: exaPlugin.contractAddress,
          exaPreviewer: exaPreviewer.contractAddress,
          integrationPreviewer: integrationPreviewer.address,
          issuerChecker: issuerChecker.contractAddress,
          marketUSDC: marketUSDC.address,
          marketWETH: marketWETH.address,
          previewer: previewer.address,
          proposalManager: proposalManager.contractAddress,
          ratePreviewer: ratePreviewer.address,
          refunder: refunder.contractAddress,
          swapper,
          usdc: usdc.address,
          weth: weth.address,
          ...(chainId !== base.id &&
            chainId !== anvil.id && {
              exaAccountFactory:
                {
                  [optimism.id]: "0x961EbA47650e2198A959Ef5f337E542df5E4F61b",
                }[chainId] ?? "0x98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC",
            }),
        },
        {
          ...((chainId === base.id || chainId === anvil.id) && { scripts: { exaAccountFactory: "ExaAccountFactory" } }),
          optional: {
            balancerVault: balancerVault?.address,
            flashLoanAdapter: flashLoanAdapter?.address,
            firewall: firewall?.address,
          },
        },
      ),
      foundry({
        forge: { build: false },
        project: "../contracts",
        exclude: foundryDefaultExcludes.filter((exclude) => exclude !== "MockERC20.sol/**"),
        include: [
          "ExaAccountFactory.sol/ExaAccountFactory.json",
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "IssuerChecker.sol/IssuerChecker.json",
          "MockERC20.sol/MockERC20.json",
          "MockSwapper.sol/MockSwapper.json",
          "ProposalManager.sol/ProposalManager.json",
          "Refunder.sol/Refunder.json",
          "UpgradeableModularAccount.sol/UpgradeableModularAccount.json",
        ],
      }),
      chain(),
    ],
  },
]);

function addresses(
  contracts: Record<string, string>,
  { scripts, optional }: { optional?: Record<string, string | undefined>; scripts?: Record<string, string> } = {},
): Plugin {
  return {
    name: "Addresses",
    run() {
      if (scripts) {
        for (const [key, script] of Object.entries(scripts)) {
          const output = execSync(`forge script -s 'getAddress()' script/${script}.s.sol --chain ${chainId}`, {
            cwd: "../contracts",
            encoding: "utf8",
          });
          const address = new RegExp(/== return ==\n0: address (0x[\da-f]{40})/i).exec(output)?.[1];
          if (!address) throw new Error(output);
          contracts[key] = address;
        }
      }
      return {
        content: `${[
          ...Object.entries(contracts).map(
            ([key, value]) => `export const ${key}Address = "${getAddress(value)}" as const`,
          ),
          ...Object.entries(optional ?? {}).map(
            ([key, value]) =>
              `export const ${key}Address = ${value ? `"${getAddress(value)}"` : "undefined"} as \`0x\${string}\` | undefined`,
          ),
        ].join("\n")}\n`,
      };
    },
  };
}

function chain() {
  if (chainId === anvil.id) {
    return {
      name: "Chain",
      run: () => ({
        content: `import { anvil, type Chain } from "viem/chains"\nconst chain = anvil as Chain\nchain.rpcUrls.alchemy = chain.rpcUrls.default\nexport default chain as Chain & { rpcUrls: { alchemy: { http: readonly [string] } } }`,
      }),
    };
  }
  const importName = {
    [base.id]: "base",
    [baseSepolia.id]: "baseSepolia",
    [optimism.id]: "optimism",
    [optimismSepolia.id]: "optimismSepolia",
    [anvil.id]: "anvil",
  }[chainId];
  if (!importName) throw new Error("unknown chain");
  return {
    name: "Chain",
    run: () => ({
      content: `import { ${importName} } from '@account-kit/infra'
import { type Chain } from "viem/chains"
export default ${importName} as Chain & { rpcUrls: { alchemy: { http: readonly [string] } } }`,
    }),
  };
}

type Deployment = { address: string };

function loadDeployment<R extends boolean = true>(
  contract: string,
  required = true as R,
): R extends true ? Deployment : Deployment | undefined {
  if (chainId === anvil.id) {
    const address =
      loadBroadcast("Protocol").transactions[
        {
          Auditor: 1,
          Firewall: 37,
          MarketUSDC: 13,
          MarketWETH: 21,
          IntegrationPreviewer: 33,
          Previewer: 32,
          RatePreviewer: 34,
          USDC: 11,
          WETH: 19,
        }[contract] ?? Infinity
      ]?.contractAddress;
    if (!address && required) throw new Error(`unknown contract: ${contract}`);
    return { address } as R extends true ? Deployment : Deployment | undefined;
  }
  const network = {
    [base.id]: "base",
    [baseSepolia.id]: "base-sepolia",
    [optimism.id]: "optimism",
    [optimismSepolia.id]: "op-sepolia",
  }[chainId];
  if (!network) throw new Error("unknown chain");
  try {
    return JSON.parse(
      readFileSync(`node_modules/@exactly/protocol/deployments/${network}/${contract}.json`, "utf8"),
    ) as never;
  } catch (error) {
    if (!required) return undefined as never;
    throw error;
  }
}

function loadBroadcast(script: string) {
  return JSON.parse(
    readFileSync(`node_modules/@exactly/plugin/broadcast/${script}.s.sol/${chainId}/run-latest.json`, "utf8"),
  ) as { transactions: { contractAddress: string }[] };
}

function exaAccountFactoryAddress(id: number) {
  const admin =
    {
      [anvil.id]: deploy.accounts.admin["31337"],
      [optimism.id]: deploy.accounts.admin["10"],
      [base.id]: deploy.accounts.admin["8453"],
    }[id] ?? deploy.accounts.admin.default;
  const factory =
    {
      [optimismSepolia.id]: "0xcc3f41204a1324DD91F1Dbfc46208535293A371e",
      [baseSepolia.id]: "0x9f275F6D25232FFf082082a53C62C6426c1cc94C",
    }[id] ?? "0x93FEC2C00BfE902F733B57c5a6CeeD7CD1384AE1";
  const salt = keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["Exa Plugin", "1.1.0"]));
  const finalSalt = keccak256(encodePacked(["address", "bytes32"], [getAddress(admin), salt]));
  const proxy = getCreate2Address({
    from: getAddress(factory),
    salt: finalSalt,
    bytecodeHash: "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f",
  });
  return getContractAddress({ from: proxy, nonce: 1n });
}
