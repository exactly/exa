import { defineConfig } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";
import { execSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { env } from "node:process";
import { getAddress, type Abi, type Chain } from "viem";
import { anvil, base, baseSepolia, optimism, optimismSepolia } from "viem/chains";

import deploy from "@exactly/plugin/deploy.json" with { type: "json" };
import ExaPreviewer from "@exactly/plugin/out/build/ExaPreviewer.sol/ExaPreviewer.json" with { type: "json" };
import Auditor from "@exactly/protocol/deployments/base/Auditor.json" with { type: "json" };
import Firewall from "@exactly/protocol/deployments/base/Firewall.json" with { type: "json" };
import FlashLoanAdapter from "@exactly/protocol/deployments/base/FlashLoanAdapter.json" with { type: "json" };
import IntegrationPreviewer from "@exactly/protocol/deployments/base/IntegrationPreviewer.json" with { type: "json" };
import Market from "@exactly/protocol/deployments/base/MarketWETH.json" with { type: "json" };
import Previewer from "@exactly/protocol/deployments/base/Previewer.json" with { type: "json" };
import RatePreviewer from "@exactly/protocol/deployments/base/RatePreviewer.json" with { type: "json" };

const chainId = Number(env.CHAIN_ID ?? String(env.EAS_BUILD_RUNNER === "eas-build" ? optimism.id : optimismSepolia.id));
const networks = new Map<Chain, string>([
  [base, "base"],
  [baseSepolia, "base-sepolia"],
  [optimism, "optimism"],
  [optimismSepolia, "op-sepolia"],
]);

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
      {
        name: "Exa",
        run() {
          const chain = {
            [base.id]: "base",
            [baseSepolia.id]: "baseSepolia",
            [optimism.id]: "optimism",
            [optimismSepolia.id]: "optimismSepolia",
          }[chainId];
          const testnet =
            chainId === anvil.id || Boolean([...networks.keys()].find(({ id }) => id === chainId)?.testnet);
          const markets = Object.fromEntries(
            [...networks]
              .filter(([current]) => Boolean(current.testnet) === testnet)
              .map(([{ id }, network]) => [
                id,
                readdirSync(`node_modules/@exactly/protocol/deployments/${network}`)
                  .flatMap((file) => /^Market([A-Za-z.]+)\.json$/.exec(file)?.[1] ?? [])
                  .filter((asset) => asset !== "ETHRouter")
                  .map((asset) => getAddress(loadDeployment(asset, true, id).address)),
              ]),
          );
          const auditors = [
            ...new Set([
              chainId,
              ...[...networks.keys()].filter((current) => Boolean(current.testnet) === testnet).map(({ id }) => id),
            ]),
          ].map((id) => [id, getAddress(loadDeployment("Auditor", true, id).address)]);
          const stocks = Object.keys(deploy.proposalManager.allowlist[base.id])
            .filter((address) => address.slice(0, 5).toLowerCase() === "0xb20")
            .map((address) => address.toLowerCase());
          if (stocks.length === 0) throw new Error("missing stocks");
          return {
            imports: chain
              ? `import { ${chain} as chain } from "@account-kit/infra"\nimport { type Chain } from "viem/chains"`
              : `import { anvil, type Chain } from "viem/chains"`,
            content: [
              ...Object.entries({
                auditor: loadDeployment("Auditor").address,
                debtManager: loadDeployment("DebtRoller", false)?.address ?? loadDeployment("DebtManager").address,
                exaPlugin: loadBroadcast("ExaPlugin").transactions[0]?.contractAddress,
                exaPreviewer: loadBroadcast("ExaPreviewer").transactions[0]?.contractAddress,
                integrationPreviewer: loadDeployment("IntegrationPreviewer").address,
                issuerChecker: loadBroadcast("IssuerChecker").transactions[0]?.contractAddress,
                marketUSDC: loadDeployment("MarketUSDC").address,
                marketWETH: loadDeployment("MarketWETH").address,
                previewer: loadDeployment("Previewer").address,
                proposalManager: loadBroadcast("ProposalManager").transactions[0]?.contractAddress,
                ratePreviewer: loadDeployment("RatePreviewer").address,
                refunder: loadBroadcast("Refunder").transactions[0]?.contractAddress,
                usdc: loadDeployment("USDC").address,
                weth: loadDeployment("WETH").address,
                simple7702Account: "0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9",
                swapper:
                  (deploy.accounts.swapper as Record<string, string>)[chainId] ?? deploy.accounts.swapper.default,
                exaAccountFactory:
                  chainId === base.id || chainId === baseSepolia.id || chainId === anvil.id
                    ? /== return ==\n0: address (0x[\da-f]{40})/i.exec(
                        execSync(`forge script -s 'getAddress()' script/ExaAccountFactory.s.sol --chain ${chainId}`, {
                          env: { ...env, FOUNDRY_PROFILE: "tooling" },
                          cwd: "../contracts",
                          encoding: "utf8",
                        }),
                      )?.[1]
                    : ({ [optimism.id]: "0x961EbA47650e2198A959Ef5f337E542df5E4F61b" }[chainId] ??
                      "0x98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC"),
              }).map(([key, address]) => {
                if (!address) throw new Error(`missing ${key}`);
                return `export const ${key}Address = "${getAddress(address)}" as const`;
              }),
              ...Object.entries({
                balancerVault: loadDeployment("Balancer2Vault", false)?.address,
                exa: loadDeployment("EXA", false)?.address,
                flashLoanAdapter: loadDeployment("FlashLoanAdapter", false)?.address,
              }).map(
                ([key, address]) =>
                  `export const ${key}Address = ${address ? `"${getAddress(address)}"` : "undefined"} as \`0x\${string}\` | undefined`,
              ),
              `export const allowlists: Record<string, readonly string[] | undefined> = ${JSON.stringify(
                Object.fromEntries(
                  Object.entries(deploy.proposalManager.allowlist as Record<string, Record<string, string>>).map(
                    ([id, tokens]) => [
                      id,
                      [...(markets[id] ?? []), ...Object.keys(tokens).map((address) => getAddress(address))],
                    ],
                  ),
                ),
              )}`,
              `export const auditors: ReadonlyMap<number, \`0x\${string}\`> = new Map(${JSON.stringify(auditors)})`,
              `export const exaPreviewerCode: \`0x\${string}\` = "${ExaPreviewer.bytecode.object}"`,
              `export const stocks: ReadonlySet<string> = new Set(${JSON.stringify(stocks)})`,
              ...(chain
                ? []
                : [
                    "const chain = anvil as Chain",
                    "chain.testnet = true",
                    "chain.rpcUrls.alchemy = chain.rpcUrls.default",
                    `chain.contracts = { multicall3: { address: "${optimism.contracts.multicall3.address}" } }`,
                    'chain.blockExplorers = { default: { name: "Otterscan", url: "http://localhost:5100" } }',
                  ]),
              `export const isBase: boolean = ${chainId === base.id || chainId === baseSepolia.id}`,
              `export default chain as Chain & { contracts: { multicall3: { address: \`0x\${string}\` } }; rpcUrls: { alchemy: { http: readonly [string] } } }`,
            ].join("\n"),
          };
        },
      },
    ],
  },
]);

function loadDeployment<R extends boolean = true>(
  contract: string,
  required = true as R,
  id = chainId,
): R extends true ? Deployment : Deployment | undefined {
  if (id === anvil.id) {
    const address =
      loadBroadcast("Protocol").transactions[
        {
          Auditor: 1,
          Balancer2Vault: 23,
          DebtManager: 24,
          MarketUSDC: 11,
          MarketWETH: 18,
          IntegrationPreviewer: 29,
          Previewer: 28,
          RatePreviewer: 30,
          USDC: 9,
          WETH: 16,
        }[contract] ?? Infinity
      ]?.contractAddress;
    if (!address && required) throw new Error(`unknown contract: ${contract}`);
    return { address } as R extends true ? Deployment : Deployment | undefined;
  }
  const network = [...networks].find(([chain]) => chain.id === id)?.[1];
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
