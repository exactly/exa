import { defineConfig, type Plugin } from "@wagmi/cli";
import { foundry, foundryDefaultExcludes, react } from "@wagmi/cli/plugins";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { getAddress, type Abi } from "viem";
import { anvil, base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import deploy from "@exactly/plugin/deploy.json" with { type: "json" };
import Auditor from "@exactly/protocol/deployments/base/Auditor.json" with { type: "json" };
import Firewall from "@exactly/protocol/deployments/base/Firewall.json" with { type: "json" };
import FlashLoanAdapter from "@exactly/protocol/deployments/base/FlashLoanAdapter.json" with { type: "json" };
import IntegrationPreviewer from "@exactly/protocol/deployments/base/IntegrationPreviewer.json" with { type: "json" };
import Market from "@exactly/protocol/deployments/base/MarketWETH.json" with { type: "json" };
import Previewer from "@exactly/protocol/deployments/base/Previewer.json" with { type: "json" };
import RatePreviewer from "@exactly/protocol/deployments/base/RatePreviewer.json" with { type: "json" };

const chainId = Number(env.CHAIN_ID ?? String(env.EAS_BUILD_RUNNER === "eas-build" ? optimism.id : optimismSepolia.id));

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
      { name: "Auditor", abi: Auditor.abi as Abi },
      { name: "IntegrationPreviewer", abi: IntegrationPreviewer.abi as Abi },
      { name: "FlashLoanAdapter", abi: FlashLoanAdapter.abi as Abi },
      { name: "Market", abi: Market.abi as Abi },
      { name: "Previewer", abi: Previewer.abi as Abi },
      { name: "RatePreviewer", abi: RatePreviewer.abi as Abi },
    ],
    plugins: [
      foundry({
        forge: { build: false },
        project: "../contracts",
        include: [
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "ProposalManager.sol/ProposalManager.json",
          "UpgradeableModularAccount.sol/UpgradeableModularAccount.json",
        ],
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
          ...((chainId === base.id || chainId === baseSepolia.id || chainId === anvil.id) && {
            scripts: { exaAccountFactory: "ExaAccountFactory" },
          }),
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

function chain(): Plugin {
  if (chainId === anvil.id) {
    return {
      name: "Chain",
      run: () => ({
        content: `import { anvil, type Chain } from "viem/chains"
const chain = anvil as Chain
chain.rpcUrls.alchemy = chain.rpcUrls.default
chain.blockExplorers = { default: { name: "Otterscan", url: "http://localhost:5100" } }
export default chain as Chain & { rpcUrls: { alchemy: { http: readonly [string] } } }`,
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
      content: `import { ${importName} } from "@account-kit/infra"
import { type Chain } from "viem/chains"
export default ${importName} as Chain & { rpcUrls: { alchemy: { http: readonly [string] } } }`,
    }),
  };
}

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

type Deployment = {
  address: string;
};
