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
import alchemyAPIKeys from "./alchemyAPIKeys";
import factoryChainBlocks from "./factoryChains.json" with { type: "json" };
import factoryVersion from "./factoryVersion.json" with { type: "json" };

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
          "Depositor.sol/Depositor.json",
          "ExaAccountFactory.sol/ExaAccountFactory.json",
          "ExaPlugin.sol/ExaPlugin.json",
          "ExaPreviewer.sol/ExaPreviewer.json",
          "IssuerChecker.sol/IssuerChecker.json",
          "MockSwapper.sol/MockSwapper.json",
          "PricePreviewer.sol/PricePreviewer.json",
          "ProposalManager.sol/ProposalManager.json",
          "Refunder.sol/Refunder.json",
          "UpgradeableModularAccount.sol/UpgradeableModularAccount.json",
          "WebauthnOwnerPlugin.sol/WebauthnOwnerPlugin.json",
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
          function contracts(id: number) {
            const exaPreviewer = loadBroadcast("ExaPreviewer", id).transactions[0]?.contractAddress;
            if (!exaPreviewer) throw new Error(`missing exaPreviewer on ${id}`);
            const webauthnOwnerPlugin = (
              id === anvil.id || id === moonbeamDev.id
                ? loadBroadcast("Account", id)
                : loadBroadcast("Plugin", id, "@exactly/plugin/node_modules/webauthn-owner-plugin")
            ).transactions[0]?.contractAddress;
            if (!webauthnOwnerPlugin) throw new Error(`missing webauthnOwnerPlugin on ${id}`);
            return [
              id,
              {
                auditor: getAddress(loadDeployment("Auditor", true, id).address),
                exaPreviewer: getAddress(exaPreviewer),
                previewer: getAddress(loadDeployment("Previewer", true, id).address),
                ratePreviewer: getAddress(loadDeployment("RatePreviewer", true, id).address),
                webauthnOwnerPlugin: getAddress(webauthnOwnerPlugin),
              },
            ] as const;
          }
          const chainContracts = (chain ? sameSide.map(([{ id }]) => id) : [anvil.id, moonbeamDev.id]).map((id) =>
            contracts(id),
          );
          const peerIds = chain ? [] : sameSide.map(([{ id }]) => id);
          const peers = peerIds.map((id) => contracts(id));
          const networkConfig: Record<
            string,
            undefined | { network: string; slug: string; testnet?: boolean; webhooks?: boolean }
          > = alchemyNetworks;
          const slugs = Object.fromEntries(
            Object.entries(networkConfig).flatMap(([id, config]) => (config ? [[id, config.slug]] : [])),
          ) as Record<number, string | undefined>;
          const admin = getAddress(perChain(deploy.accounts.admin));
          const create3Factory = getAddress(perChain(deploy.factory.create3));
          const version = perChain(factoryVersion);
          if (!deploy.factory.versions.includes(version)) throw new Error(`unlisted factory version ${version}`);
          function factory(v: string) {
            const salt = keccak256(encodeAbiParameters([{ type: "string" }, { type: "string" }], ["Exa Plugin", v]));
            return getContractAddress({
              from: getContractAddress({
                opcode: "CREATE2",
                from: testnet ? getAddress(perChain(deploy.factory.createx)) : create3Factory,
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
            legacy: chain ? perChain(deploy.factory.legacy).map((address) => getAddress(address)) : [factory("legacy")],
          };
          function mockfi(id: number | string) {
            if (!chain || !testnet || !networkConfig[id]?.testnet) return;
            const broadcast = loadBroadcast("Swapper", Number(id), undefined, false);
            const create = broadcast?.transactions.find(({ contractName }) => contractName === "MockSwapper");
            const receipt = broadcast?.receipts.find(({ transactionHash }) => transactionHash === create?.hash);
            if (!create?.contractAddress || !receipt) return;
            return { startBlock: Number(receipt.blockNumber), swapper: getAddress(create.contractAddress) };
          }
          function chainFields(id: number | string) {
            const deployed = mockfi(id);
            const swapper =
              id in deploy.accounts.swapper || id in factoryChainBlocks
                ? getAddress(perChain(deploy.accounts.swapper, Number(id)))
                : deployed?.swapper;
            if (deployed && deployed.swapper !== swapper) throw new Error(`stale swapper ${id}`);
            return {
              ...(networkConfig[id]?.testnet && { testnet: true }),
              ...(swapper && { swapper }),
              ...(deployed && { mockfi: { startBlock: deployed.startBlock } }),
            };
          }
          function fieldSource(id: number | string) {
            return Object.entries(chainFields(id))
              .map(([key, value]) => `, ${key}: ${JSON.stringify(value)}`)
              .join("");
          }
          const alchemyChains: { id: number; name?: string; source: string }[] = Object.values(infra).flatMap((c) => {
            if (typeof c !== "object" || !("rpcUrls" in c)) return [];
            const { alchemy, ...rpcUrls } = c.rpcUrls;
            const slug = slugs[c.id];
            if (!alchemy && !slug) return [];
            const alchemyNetwork = networkConfig[c.id]?.network;
            if (!alchemyNetwork) return [];
            const remote = alchemy?.http[0] ?? `https://${slug}.g.alchemy.com/v2`;
            const local = peerIds.includes(c.id) ? `${remote}/${alchemyAPIKeys[c.id]}` : anvil.rpcUrls.default.http[0];
            const url = chain ? remote : local;
            const name = Object.entries(chains).find(([, v]) => isDeepStrictEqual(v, { ...c, rpcUrls }))?.[0];
            if (!name && (c.formatters ?? c.serializers ?? c.fees)) throw new Error(`lossy chain ${c.id}`);
            return [
              {
                id: c.id,
                name,
                source: name
                  ? `{ ...${name}, smartAccount: true, rpcUrls: { ...${name}.rpcUrls, alchemy: { http: ["${url}"] } }, alchemyNetwork: "${alchemyNetwork}"${fieldSource(c.id)} }`
                  : `defineChain(${JSON.stringify({ ...c, smartAccount: true, rpcUrls: { ...rpcUrls, alchemy: { http: [url] } }, alchemyNetwork, ...chainFields(c.id) })})`,
              },
            ];
          });
          for (const [id, network] of Object.entries(slugs)) {
            if (alchemyChains.some((c) => c.id === Number(id))) continue;
            const name = Object.entries(chains).find(([, c]) => c.id === Number(id))?.[0];
            const url = chain ? `https://${network}.g.alchemy.com/v2` : anvil.rpcUrls.default.http[0];
            const alchemyNetwork = networkConfig[id]?.network;
            if (!alchemyNetwork) throw new Error(`missing alchemy network ${id}`);
            alchemyChains.push({
              id: Number(id),
              name,
              source: name
                ? `{ ...${name}, rpcUrls: { ...${name}.rpcUrls, alchemy: { http: ["${url}"] } }, alchemyNetwork: "${alchemyNetwork}"${fieldSource(id)} }`
                : JSON.stringify({
                    id: Number(id),
                    name: network,
                    rpcUrls: { default: { http: [url] }, alchemy: { http: [url] } },
                    alchemyNetwork,
                    ...chainFields(id),
                  }),
            });
          }
          const factoryChains = Object.entries(factoryChainBlocks).flatMap(([key, startBlock]) => {
            const id = Number(key);
            if (id === anvil.id || id === moonbeamDev.id) return chain ? [] : [{ id, startBlock }];
            const known = Object.values(chains).find((c) => c.id === id);
            if (!known) throw new Error(`unknown factory chain ${id}`);
            if (!alchemyChains.some((c) => c.id === id)) throw new Error(`missing alchemy chain ${id}`);
            return chain && Boolean(known.testnet) === testnet ? [{ id, startBlock }] : [];
          });
          for (const [id] of chainContracts) {
            if (!factoryChains.some((current) => current.id === id)) throw new Error(`missing factory chain ${id}`);
          }
          const allowlists: Record<string, Record<string, string>> = { ...deploy.proposalManager.allowlist };
          if (!chain) {
            alchemyChains.push(
              { id: anvil.id, source: "chain" },
              {
                id: moonbeamDev.id,
                source: `defineChain(${JSON.stringify({ ...moonbeamDev, name: "Anvil2", smartAccount: true, contracts: { multicall3: { address: optimism.contracts.multicall3.address } }, rpcUrls: { ...moonbeamDev.rpcUrls, alchemy: moonbeamDev.rpcUrls.default }, alchemyNetwork: "ANVIL2", ...chainFields(moonbeamDev.id) })})`,
              },
            );
            allowlists[moonbeamDev.id] = { "0x345108DA76464B8115ABcDBf0E8C969c470aE02c": "USDC.e" };
          }
          const activityChains = alchemyChains.flatMap(({ id }) =>
            (
              chain
                ? networkConfig[id]?.webhooks &&
                  Boolean(networkConfig[id].testnet) === testnet &&
                  (!testnet ||
                    sameSide.some(([current]) => current.id === id) ||
                    factoryChains.some((current) => current.id === id) ||
                    mockfi(id))
                : id === anvil.id || id === moonbeamDev.id
            )
              ? [[id, {}] as const]
              : [],
          );
          for (const { id } of factoryChains) {
            if (!activityChains.some(([current]) => current === id)) throw new Error(`missing activity chain ${id}`);
          }
          const source = alchemyChains.find(({ id }) => id === chainId)?.source;
          if (chain && !source) throw new Error("missing alchemy chain");
          function chainMap(entries: readonly (readonly [number, Record<string, unknown>])[]) {
            return `new Map([${entries
              .map(([id, fields]) => {
                const s = id === chainId ? "chain" : alchemyChains.find((c) => c.id === id)?.source;
                if (!s) throw new Error(`missing alchemy chain ${id}`);
                return `[${id}, { ${s.startsWith("{") ? s.slice(1, -1).trim() : `...${s}`}, ${JSON.stringify(fields).slice(1, -1)} }]`;
              })
              .join(", ")}])`;
          }
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
                swapper: perChain(deploy.accounts.swapper),
                exaAccountFactory: factory(version),
              }).map(([key, address]) => {
                if (!address) throw new Error(`missing ${key}`);
                return `export const ${key}Address = "${getAddress(address)}" as const`;
              }),
              ...Object.entries({
                balancerVault: loadDeployment("Balancer2Vault", false)?.address,
                depositor: loadBroadcast("Depositor", chainId, undefined, false)?.transactions[0]?.contractAddress,
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
              `export const issuerCheckerPreviewerCode: \`0x\${string}\` = "${IssuerCheckerPreviewer.deployedBytecode.object}"`,
              `export const pricePreviewerCode: \`0x\${string}\` = "${PricePreviewer.bytecode.object}"`,
              'type AlchemyChain = ((Chain & { smartAccount: true }) | (Omit<Chain, "nativeCurrency"> & { nativeCurrency?: Chain["nativeCurrency"]; smartAccount?: never })) & { alchemyNetwork: string; mockfi?: Readonly<{ startBlock: number }>; rpcUrls: { alchemy: { http: readonly [string] } }; swapper?: `0x${string}` }',
              ...(chain
                ? [`const chain: AlchemyChain & { smartAccount: true; swapper: \`0x\${string}\` } = ${source}`]
                : [
                    "const chain = anvil as Chain as AlchemyChain & { smartAccount: true; swapper: `0x${string}` }",
                    "chain.smartAccount = true",
                    "chain.testnet = true",
                    `chain.blockTime = ${optimism.blockTime}`,
                    `chain.rpcUrls.alchemy = { http: ["${anvil.rpcUrls.default.http[0]}"] }`,
                    'chain.alchemyNetwork = "ANVIL"',
                    ...Object.entries(chainFields(anvil.id)).map(
                      ([key, value]) => `chain.${key} = ${JSON.stringify(value)}`,
                    ),
                    `chain.contracts = { multicall3: { address: "${optimism.contracts.multicall3.address}" } }`,
                    'chain.blockExplorers = { default: { name: "Otterscan", url: "http://localhost:5100" } }',
                  ]),
              `export const activityChains: ReadonlyMap<number, AlchemyChain> = ${chainMap(activityChains)}`,
              `export const alchemyChains: ReadonlyMap<number, AlchemyChain> = new Map<number, AlchemyChain>([${alchemyChains
                .map(({ id, source: s }) => `[${id}, ${id === chainId ? "chain" : s}]`)
                .join(", ")}])`,
              `export const chains: ReadonlyMap<number, AlchemyChain & Readonly<Record<"auditor" | "exaPreviewer" | "previewer" | "ratePreviewer" | "swapper" | "webauthnOwnerPlugin", \`0x\${string}\`>>> = ${chainMap(chainContracts)}`,
              `export const factoryChains: ReadonlyMap<number, AlchemyChain & Readonly<{ startBlock: number; swapper: \`0x\${string}\` }>> = ${chainMap(factoryChains.map(({ id, startBlock }) => [id, { startBlock }] as const))}`,
              `export const peers: ReadonlyMap<number, AlchemyChain & Readonly<Record<"auditor" | "exaPreviewer" | "previewer" | "ratePreviewer" | "swapper" | "webauthnOwnerPlugin", \`0x\${string}\`>>> = ${chainMap(peers)}`,
              `export const isBase: boolean = ${chainId === base.id || chainId === baseSepolia.id}`,
              `export const lifiURL: string = ${JSON.stringify(chainId === anvil.id ? "http://localhost:3000/hooks/mockfi/v1" : testnet ? "https://sandbox-mockfi-948982108490.us-west1.run.app/v1" : "https://li.quest/v1")}`,
              `export default chain as Chain & { alchemyNetwork: string; swapper: \`0x\${string}\`; smartAccount: true; contracts: { multicall3: { address: \`0x\${string}\` } }; rpcUrls: { alchemy: { http: readonly [string] } } }`,
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

function loadBroadcast<R extends boolean = true>(
  script: string,
  id = chainId,
  root = "@exactly/plugin",
  required = true as R,
): R extends true ? Broadcast : Broadcast | undefined {
  try {
    return JSON.parse(
      readFileSync(
        `node_modules/${root}/broadcast/${script}.s.sol/${id === moonbeamDev.id ? anvil.id : id}/run-latest.json`,
        "utf8",
      ),
    ) as never;
  } catch (error) {
    if (!required) return undefined as never;
    throw error;
  }
}

function perChain<T>(values: Record<string, T> & { default: T }, id = chainId) {
  return values[id] ?? values.default;
}

type Broadcast = {
  receipts: { blockNumber: string; transactionHash: string }[];
  transactions: { contractAddress: string; contractName: null | string; hash: string }[];
};

type Deployment = {
  address: string;
};
