import "dotenv/config";
import { defineConfig, type Plugin } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { type Abi, getAddress } from "viem";
import { optimism, optimismSepolia } from "viem/chains";

const easBuild = process.env.EAS_BUILD_RUNNER === "eas-build";

const chainId = Number(process.env.CHAIN_ID ?? String(easBuild ? optimism.id : optimismSepolia.id));

if (easBuild) {
  execSync(
    "export FOUNDRY_DIR=${FOUNDRY_DIR-$HOME/workingdir} && curl -L https://foundry.paradigm.xyz | bash || true && foundryup",
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
const balancerVault = loadDeployment("BalancerVault");
const [exaPlugin] = loadBroadcast("ExaPlugin").transactions;
const [issuerChecker] = loadBroadcast("IssuerChecker").transactions;
const [proposalManager] = loadBroadcast("ProposalManager").transactions;
const [refunder] = loadBroadcast("Refunder").transactions;
const [exaPreviewer] = loadBroadcast("ExaPreviewer").transactions;
const [, swapper] =
  chainId === optimismSepolia.id
    ? loadBroadcast("Mocks").transactions
    : [null, { contractAddress: "0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE", contractName: "LifiGateway" }];
if (!exaPlugin || !issuerChecker || !proposalManager || !exaPreviewer || !refunder) {
  throw new Error("missing contracts");
}

execSync("forge build", { cwd: "contracts", stdio: "inherit" });

export default defineConfig([
  {
    out: "src/generated/contracts.ts",
    contracts: [
      { name: "Auditor", abi: auditor.abi },
      { name: "IntegrationPreviewer", abi: integrationPreviewer.abi },
      { name: "Market", abi: marketWETH.abi },
      { name: "Previewer", abi: previewer.abi },
      { name: "RatePreviewer", abi: ratePreviewer.abi },
    ],
    plugins: [
      foundry({
        forge: { build: false },
        project: "contracts",
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
    out: "common/generated/chain.ts",
    plugins: [
      addresses(
        {
          auditor: auditor.address,
          balancerVault: balancerVault.address,
          exaPlugin: exaPlugin.contractAddress,
          exaPreviewer: exaPreviewer.contractAddress,
          integrationPreviewer: integrationPreviewer.address,
          marketUSDC: marketUSDC.address,
          marketWETH: marketWETH.address,
          previewer: previewer.address,
          proposalManager: proposalManager.contractAddress,
          ratePreviewer: ratePreviewer.address,
          swapper: swapper.contractAddress,
          usdc: usdc.address,
          weth: weth.address,
        },
        { exaAccountFactory: "ExaAccountFactory" },
      ),
      foundry({
        forge: { build: false },
        project: "contracts",
        include: ["ExaAccountFactory.sol/ExaAccountFactory.json", "MockSwapper.sol/MockSwapper.json"],
      }),
      chain(),
    ],
  },
  {
    out: "server/generated/contracts.ts",
    contracts: [
      { name: "Auditor", abi: auditor.abi },
      { name: "Market", abi: marketWETH.abi },
      { name: "Previewer", abi: previewer.abi },
    ],
    plugins: [
      addresses({
        issuerChecker: issuerChecker.contractAddress,
        refunder: refunder.contractAddress,
      }),
      foundry({
        forge: { build: false },
        project: "contracts",
        include: [
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "IssuerChecker.sol/IssuerChecker.json",
          "ProposalManager.sol/ProposalManager.json",
          "Refunder.sol/Refunder.json",
          "UpgradeableModularAccount.sol/UpgradeableModularAccount.json",
        ],
      }),
    ],
  },
]);

function addresses(contracts: Record<string, string>, scripts?: Record<string, string>): Plugin {
  return {
    name: "Addresses",
    run() {
      if (scripts) {
        for (const [key, script] of Object.entries(scripts)) {
          const output = execSync(
            `forge script -s 'getAddress()' script/${script}.s.sol --chain ${chainId} --etherscan-api-key x`,
            { cwd: "contracts", encoding: "utf8" },
          );
          const address = new RegExp(/== return ==\n0: address (0x[\da-f]{40})/i).exec(output)?.[1];
          if (!address) throw new Error(output);
          contracts[key] = address;
        }
      }
      return {
        content: `${Object.entries(contracts)
          .map(([key, value]) => `export const ${key}Address = "${getAddress(value)}" as const`)
          .join("\n")}\n`,
      };
    },
  };
}

function chain(): Plugin {
  const importName = { [optimism.id]: "optimism", [optimismSepolia.id]: "optimismSepolia" }[chainId];
  if (!importName) throw new Error("unknown chain");
  return { name: "Chain", run: () => ({ content: `export { ${importName} as default } from "@alchemy/aa-core"` }) };
}

function loadDeployment(contract: string) {
  return JSON.parse(
    readFileSync(
      `node_modules/@exactly/protocol/deployments/${chainId === optimism.id ? "optimism" : "op-sepolia"}/${contract}.json`,
      "utf8",
    ),
  ) as { address: string; abi: Abi };
}

function loadBroadcast(script: string) {
  return JSON.parse(
    readFileSync(`node_modules/@exactly/plugin/broadcast/${script}.s.sol/${chainId}/run-latest.json`, "utf8"),
  ) as { transactions: { contractAddress: string }[] };
}
