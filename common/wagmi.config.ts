import deploy from "@exactly/plugin/deploy.json" with { type: "json" };
import Firewall from "@exactly/protocol/deployments/base/Firewall.json" with { type: "json" };
import FlashLoanAdapter from "@exactly/protocol/deployments/base/FlashLoanAdapter.json" with { type: "json" };
import { defineConfig, type Plugin } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { env } from "node:process";
import { getAddress, type Abi } from "viem";
import { base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

const easBuild = env.EAS_BUILD_RUNNER === "eas-build";

const chainId = Number(env.CHAIN_ID ?? String(easBuild ? optimism.id : optimismSepolia.id));

if (easBuild) {
  execSync(
    "export FOUNDRY_DIR=${FOUNDRY_DIR-$HOME/workingdir} && curl -L https://foundry.paradigm.xyz | bash || true && foundryup -i v1.3.6",
    { stdio: "inherit" },
  );
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

execSync("forge build", { cwd: "../contracts", stdio: "inherit" });

export default defineConfig([
  {
    out: "generated/hooks.ts",
    contracts: [
      { name: "Auditor", abi: auditor.abi },
      { name: "IntegrationPreviewer", abi: integrationPreviewer.abi },
      { name: "FlashLoanAdapter", abi: FlashLoanAdapter.abi as Abi },
      { name: "Market", abi: marketWETH.abi },
      { name: "Previewer", abi: previewer.abi },
      { name: "RatePreviewer", abi: ratePreviewer.abi },
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
      { name: "Auditor", abi: auditor.abi },
      { name: "Firewall", abi: Firewall.abi as Abi },
      { name: "Market", abi: marketWETH.abi },
      { name: "Previewer", abi: previewer.abi },
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
        },
        {
          scripts: { exaAccountFactory: "ExaAccountFactory" },
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
        include: [
          "ExaAccountFactory.sol/ExaAccountFactory.json",
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "IssuerChecker.sol/IssuerChecker.json",
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
  { scripts, optional }: { scripts?: Record<string, string>; optional?: Record<string, string | undefined> } = {},
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
  const importName = {
    [base.id]: "base",
    [baseSepolia.id]: "baseSepolia",
    [optimism.id]: "optimism",
    [optimismSepolia.id]: "optimismSepolia",
  }[chainId];
  if (!importName) throw new Error("unknown chain");
  return { name: "Chain", run: () => ({ content: `export { ${importName} as default } from "@alchemy/aa-core"` }) };
}

function loadDeployment<R extends boolean = true>(
  contract: string,
  required = true as R,
): R extends true ? Deployment : Deployment | undefined {
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

interface Deployment {
  address: string;
  abi: Abi;
}
