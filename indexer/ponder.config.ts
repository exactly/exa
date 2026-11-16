import { env } from "node:process";
import { createConfig, factory } from "ponder";
import { getAbiItem, zeroAddress } from "viem";
import { anvil, base, baseSepolia, moonbeamDev, optimism, optimismSepolia } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, {
  alchemyChains,
  auditorAbi,
  chains,
  exaAccountFactoryAbi,
  exaPluginAbi,
  factories,
  factoryChains,
  marketAbi,
  mockSwapperAbi,
  peers,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  webauthnOwnerPluginAbi,
} from "@exactly/common/generated/chain";

const addresses = [...factories.versions, ...factories.legacy];
const ownerUpdated = getAbiItem({
  abi: webauthnOwnerPluginAbi,
  name: "OwnerUpdated",
  args: [zeroAddress, [{ x: 0n, y: 0n }], []],
});
const sources = [...chains].map(([id, { auditor, swapper, webauthnOwnerPlugin }]) => ({
  ...source(id),
  auditor,
  swapper,
  webauthnOwnerPlugin,
  auditorBlock: {
    [optimism.id]: 78_310_663,
    [base.id]: 38_135_747,
    [optimismSepolia.id]: 7_418_809,
    [baseSepolia.id]: 29_953_857,
  }[id],
  startBlock: factoryChains.get(id)?.startBlock,
}));
const bridgeSources = [
  ...sources,
  ...[...factoryChains]
    .filter(([id]) => !chains.has(id))
    .map(([id, { startBlock, swapper }]) => ({ ...source(id), startBlock, swapper })),
  ...[...(env.MOCKFI_PRIVATE_KEY ? peers : [])].map(([id, { swapper }]) => ({
    ...source(id),
    swapper,
    startBlock: "latest" as const,
  })),
];

export default createConfig({
  database: { kind: "postgres", connectionString: env.POSTGRES_URL, poolConfig: { max: 8 } },
  chains: Object.fromEntries(
    bridgeSources.map(({ network, rpc }) => [
      network.name,
      {
        id: network.id,
        rpc,
        ...((network.id === anvil.id || network.id === moonbeamDev.id) && {
          cacheRpcRequests: false,
          rateLimitRpcRequests: false,
          reorgWindow: 0,
        }),
      },
    ]),
  ),
  contracts: {
    ExaAccount: {
      abi: upgradeableModularAccountAbi,
      chain: Object.fromEntries(
        sources.map(({ network, startBlock, webauthnOwnerPlugin }) => [
          network.name,
          {
            address: factory({ address: webauthnOwnerPlugin, event: ownerUpdated, parameter: "account" }),
            startBlock,
          },
        ]),
      ),
    },
    ExaAccountFactory: {
      abi: exaAccountFactoryAbi,
      chain: Object.fromEntries(
        sources.map(({ network, startBlock }) => [network.name, { address: addresses, startBlock }]),
      ),
    },
    Auditor: {
      abi: auditorAbi,
      chain: Object.fromEntries(
        sources.map(({ auditor, auditorBlock, network }) => [
          network.name,
          { address: auditor, startBlock: auditorBlock },
        ]),
      ),
    },
    ExaPlugin: {
      abi: exaPluginAbi,
      chain: Object.fromEntries(sources.map(({ network, startBlock }) => [network.name, { startBlock }])),
    },
    Market: {
      abi: marketAbi,
      chain: Object.fromEntries(
        sources.map(({ auditor, auditorBlock, network, startBlock }) => [
          network.name,
          {
            address: factory({
              address: auditor,
              event: getAbiItem({ abi: auditorAbi, name: "MarketListed" }),
              parameter: "market",
              startBlock: auditorBlock,
            }),
            startBlock,
          },
        ]),
      ),
    },
    Swapper: {
      abi: mockSwapperAbi,
      chain: Object.fromEntries(
        bridgeSources.map(({ network, startBlock, swapper }) => [network.name, { address: swapper, startBlock }]),
      ),
    },
    WebauthnOwnerPlugin: {
      abi: webauthnOwnerPluginAbi,
      chain: Object.fromEntries(
        sources.map(({ network, startBlock, webauthnOwnerPlugin }) => [
          network.name,
          { address: webauthnOwnerPlugin, startBlock },
        ]),
      ),
    },
    ProposalManager: {
      abi: proposalManagerAbi,
      chain: Object.fromEntries(sources.map(({ network, startBlock }) => [network.name, { startBlock }])),
    },
  },
});

function source(id: number) {
  const network = id === chain.id ? chain : alchemyChains.get(id);
  const rpc = network?.rpcUrls.alchemy.http[0];
  if (!network || !rpc) throw new Error(`missing network ${id}`);
  return { network, rpc: `${rpc}/${alchemyAPIKey}` };
}
