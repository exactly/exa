import * as infra from "@account-kit/infra";
import { defineConfig } from "@wagmi/cli";
import { foundry, react } from "@wagmi/cli/plugins";
import { readdirSync, readFileSync } from "node:fs";
import { env } from "node:process";
import { isDeepStrictEqual } from "node:util";
import {
  encodeAbiParameters,
  encodePacked,
  getAddress,
  getContractAddress,
  keccak256,
  slice,
  type Abi,
  type Chain,
} from "viem";
import * as chains from "viem/chains";
import { anvil, base, baseSepolia, moonbeamDev, optimism, optimismSepolia } from "viem/chains";

import deploy from "@exactly/plugin/deploy.json" with { type: "json" };
import AppPreviewer from "@exactly/plugin/out/build/AppPreviewer.sol/AppPreviewer.json" with { type: "json" };
import IssuerCheckerPreviewer from "@exactly/plugin/out/build/IssuerCheckerPreviewer.sol/IssuerCheckerPreviewer.json" with { type: "json" };
import PricePreviewer from "@exactly/plugin/out/build/PricePreviewer.sol/PricePreviewer.json" with { type: "json" };
import Auditor from "@exactly/protocol/deployments/base/Auditor.json" with { type: "json" };
import Firewall from "@exactly/protocol/deployments/base/Firewall.json" with { type: "json" };
import FlashLoanAdapter from "@exactly/protocol/deployments/base/FlashLoanAdapter.json" with { type: "json" };
import IntegrationPreviewer from "@exactly/protocol/deployments/base/IntegrationPreviewer.json" with { type: "json" };
import Market from "@exactly/protocol/deployments/base/MarketWETH.json" with { type: "json" };
import Previewer from "@exactly/protocol/deployments/base/Previewer.json" with { type: "json" };
import RatePreviewer from "@exactly/protocol/deployments/base/RatePreviewer.json" with { type: "json" };

import alchemyNetworks from "./alchemy.json" with { type: "json" };

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
          "AppPreviewer.sol/AppPreviewer.json",
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "PricePreviewer.sol/PricePreviewer.json",
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
          "AppPreviewer.sol/AppPreviewer.json",
          "ExaAccountFactory.sol/ExaAccountFactory.json",
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "IssuerChecker.sol/IssuerChecker.json",
          "MockSwapper.sol/MockSwapper.json",
          "PricePreviewer.sol/PricePreviewer.json",
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
          const sameSide = [...networks].filter(([current]) => Boolean(current.testnet) === testnet);
          const markets = Object.fromEntries(
            sameSide.map(([{ id }, network]) => [
              id,
              readdirSync(`node_modules/@exactly/protocol/deployments/${network}`)
                .flatMap((file) => /^Market([A-Za-z.]+)\.json$/.exec(file)?.[1] ?? [])
                .filter((asset) => asset !== "ETHRouter")
                .map((asset) => getAddress(loadDeployment(asset, true, id).address)),
            ]),
          );
          const networkContracts = (chain ? sameSide.map(([{ id }]) => id) : [anvil.id, moonbeamDev.id]).map((id) => {
            const exaPreviewer = loadBroadcast("ExaPreviewer", id).transactions[0]?.contractAddress;
            if (!exaPreviewer) throw new Error(`missing exaPreviewer on ${id}`);
            return [
              id,
              {
                auditor: getAddress(loadDeployment("Auditor", true, id).address),
                exaPreviewer: getAddress(exaPreviewer),
                swapper: getAddress(deployed(deploy.accounts.swapper, id)),
              },
            ];
          });
          const slugs: Record<number, string | undefined> = alchemyNetworks;
          const admin = getAddress(deployed(deploy.accounts.admin));
          const create3Factory = getAddress(deployed(deploy.factory.create3));
          const version = deployed(deploy.factory.version);
          if (!deploy.factory.versions.includes(version)) throw new Error(`unlisted factory version ${version}`);
          function factory(v: string) {
            const salt = keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["Exa Plugin", v]));
            return getContractAddress({
              from: getContractAddress({
                opcode: "CREATE2",
                from: testnet ? "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed" : create3Factory,
                salt: testnet
                  ? keccak256(
                      encodeAbiParameters(
                        [{ type: "address" }, { type: "bytes32" }],
                        [admin, encodePacked(["address", "bytes1", "bytes11"], [admin, "0x00", slice(salt, 0, 11)])],
                      ),
                    )
                  : keccak256(encodePacked(["address", "bytes32"], [admin, salt])),
                bytecodeHash: "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f",
              }),
              nonce: 1n,
            });
          }
          const factories = {
            versions: deploy.factory.versions.map((v) => factory(v)),
            legacy: deploy.factory.legacy.map((address) => getAddress(address)),
          };
          const factoryChains = (
            chain
              ? deploy.factory.chains.filter(
                  (id) => Boolean(Object.values(chains).find((c) => c.id === id)?.testnet) === testnet,
                )
              : [anvil.id, moonbeamDev.id]
          ).map((id) => [
            id,
            {
              swapper: getAddress(
                (deploy.accounts.swapper as Record<string, string>)[id] ?? deploy.accounts.swapper.default,
              ),
            },
          ]);
          const alchemyChains: { id: number; name?: string; source: string }[] = Object.values(infra).flatMap((c) => {
            if (typeof c !== "object" || !("rpcUrls" in c)) return [];
            const { alchemy, ...rpcUrls } = c.rpcUrls;
            const slug = slugs[c.id];
            if (!alchemy && !slug) return [];
            const url = chain
              ? (alchemy?.http[0] ?? `https://${slug}.g.alchemy.com/v2`)
              : anvil.rpcUrls.default.http[0];
            const name = Object.entries(chains).find(([, v]) => isDeepStrictEqual(v, { ...c, rpcUrls }))?.[0];
            if (!name && (c.formatters ?? c.serializers ?? c.fees)) throw new Error(`lossy chain ${c.id}`);
            return [
              {
                id: c.id,
                name,
                source: name
                  ? `{ ...${name}, smartAccount: true, rpcUrls: { ...${name}.rpcUrls, alchemy: { http: ["${url}"] } } }`
                  : `defineChain(${JSON.stringify({ ...c, smartAccount: true, rpcUrls: { ...rpcUrls, alchemy: { http: [url] } } })})`,
              },
            ];
          });
          for (const [id, network] of Object.entries(alchemyNetworks)) {
            if (alchemyChains.some((c) => c.id === Number(id))) continue;
            const name = Object.entries(chains).find(([, c]) => c.id === Number(id))?.[0];
            const url = chain ? `https://${network}.g.alchemy.com/v2` : anvil.rpcUrls.default.http[0];
            alchemyChains.push({
              id: Number(id),
              name,
              source: name
                ? `{ ...${name}, rpcUrls: { ...${name}.rpcUrls, alchemy: { http: ["${url}"] } } }`
                : JSON.stringify({
                    id: Number(id),
                    name: network,
                    rpcUrls: { default: { http: [url] }, alchemy: { http: [url] } },
                  }),
            });
          }
          const allowlists: Record<string, Record<string, string>> = { ...deploy.proposalManager.allowlist };
          if (!chain) {
            alchemyChains.push(
              { id: anvil.id, source: "chain" },
              {
                id: moonbeamDev.id,
                source: `defineChain(${JSON.stringify({ ...moonbeamDev, name: "Anvil2", smartAccount: true, rpcUrls: { ...moonbeamDev.rpcUrls, alchemy: moonbeamDev.rpcUrls.default } })})`,
              },
            );
            allowlists[moonbeamDev.id] = { "0x345108DA76464B8115ABcDBf0E8C969c470aE02c": "USDC.e" };
          }
          const source = alchemyChains.find(({ id }) => id === chainId)?.source;
          if (chain && !source) throw new Error("missing alchemy chain");
          return {
            imports: [
              'import { defineChain } from "viem"',
              `import { ${[...new Set([chain ?? "anvil", ...alchemyChains.flatMap(({ name }) => name ?? [])])].join(", ")}, type Chain } from "viem/chains"`,
            ].join("\n"),
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
                ratePreviewer: loadDeployment("RatePreviewer").address,
                refunder: loadBroadcast("Refunder").transactions[0]?.contractAddress,
                usdc: loadDeployment("USDC").address,
                weth: loadDeployment("WETH").address,
                simple7702Account: "0x4Cd241E8d1510e30b2076397afc7508Ae59C66c9",
                swapper: deployed(deploy.accounts.swapper),
                exaAccountFactory: factory(version),
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
                  Object.entries(allowlists).map(([id, tokens]) => [
                    id,
                    [...(markets[id] ?? []), ...Object.keys(tokens).map((address) => getAddress(address))],
                  ]),
                ),
              )}`,
              `export const appPreviewerCode: \`0x\${string}\` = "${AppPreviewer.bytecode.object}"`,
              `export const appPreviewerDeployedCode: \`0x\${string}\` = "${AppPreviewer.deployedBytecode.object}"`,
              `export const factories: Readonly<Record<"legacy" | "versions", readonly \`0x\${string}\`[]>> = ${JSON.stringify(factories)}`,
              `export const factoryChains: ReadonlyMap<number, Readonly<Record<"swapper", \`0x\${string}\`>>> = new Map(${JSON.stringify(factoryChains)})`,
              `export const issuerCheckerPreviewerCode: \`0x\${string}\` = "${IssuerCheckerPreviewer.deployedBytecode.object}"`,
              `export const networks: ReadonlyMap<number, Readonly<Record<"auditor" | "exaPreviewer" | "swapper", \`0x\${string}\`>>> = new Map(${JSON.stringify(networkContracts)})`,
              `export const pricePreviewerCode: \`0x\${string}\` = "${PricePreviewer.bytecode.object}"`,
              'type AlchemyChain = ((Chain & { smartAccount: true }) | (Omit<Chain, "nativeCurrency"> & { nativeCurrency?: Chain["nativeCurrency"]; smartAccount?: never })) & { rpcUrls: { alchemy: { http: readonly [string] } } }',
              ...(chain
                ? [`const chain: AlchemyChain & { smartAccount: true } = ${source}`]
                : [
                    "const chain = anvil as Chain as AlchemyChain & { smartAccount: true }",
                    "chain.smartAccount = true",
                    "chain.testnet = true",
                    `chain.blockTime = ${optimism.blockTime}`,
                    `chain.rpcUrls.alchemy = { http: ["${anvil.rpcUrls.default.http[0]}"] }`,
                    `chain.contracts = { multicall3: { address: "${optimism.contracts.multicall3.address}" } }`,
                    'chain.blockExplorers = { default: { name: "Otterscan", url: "http://localhost:5100" } }',
                  ]),
              `export const alchemyChains: ReadonlyMap<number, AlchemyChain> = new Map<number, AlchemyChain>([${alchemyChains
                .map(({ id, source: s }) => `[${id}, ${id === chainId ? "chain" : s}]`)
                .join(", ")}])`,
              `export const isBase: boolean = ${chainId === base.id || chainId === baseSepolia.id}`,
              `export const lifiURL: string | undefined = ${JSON.stringify({ [anvil.id]: "http://localhost:3000/e2e/lifi/v1", [base.id]: "https://li.quest/v1", [optimism.id]: "https://li.quest/v1" }[chainId])}`,
              `export default chain as Chain & { smartAccount: true; contracts: { multicall3: { address: \`0x\${string}\` } }; rpcUrls: { alchemy: { http: readonly [string] } } }`,
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
  if (id === anvil.id || id === moonbeamDev.id) {
    const address = loadBroadcast("Protocol", id).transactions[
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

function loadBroadcast(script: string, id = chainId) {
  return JSON.parse(
    readFileSync(
      `node_modules/@exactly/plugin/broadcast/${script}.s.sol/${id === moonbeamDev.id ? anvil.id : id}/run-latest.json`,
      "utf8",
    ),
  ) as { transactions: { contractAddress: string }[] };
}

function deployed(values: Record<string, string> & { default: string }, id = chainId) {
  return values[id] ?? values.default;
}

type Deployment = {
  address: string;
};
