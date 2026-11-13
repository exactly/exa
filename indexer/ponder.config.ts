import { env } from "node:process";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { anvil, arbitrum, base, bsc, mainnet, moonbeamDev, optimism, polygon } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, {
  alchemyChains,
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  factories,
  factoryChains,
  marketAbi,
  mockSwapperAbi,
  networks,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";

const addresses = [...factories.versions, ...factories.legacy];
const sources = [...networks].map(([id, { auditor, swapper }]) => ({
  ...source(id),
  auditor,
  swapper,
  startBlock: { [optimism.id]: 123_125_164, [base.id]: 38_143_182 }[id],
}));
const bridgeSources = [
  ...sources,
  ...[...factoryChains]
    .filter(([id]) => !networks.has(id))
    .map(([id, { swapper }]) => ({
      ...source(id),
      swapper,
      startBlock: {
        [arbitrum.id]: 235_656_481,
        [bsc.id]: 40_761_099,
        [mainnet.id]: 20_378_473,
        [polygon.id]: 59_762_700,
      }[id],
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
        ...((network.id === anvil.id || network.id === moonbeamDev.id) && { cacheRpcRequests: false, reorgWindow: 0 }),
      },
    ]),
  ),
  contracts: {
    ExaAccount: {
      abi: upgradeableModularAccountAbi,
      chain: Object.fromEntries(
        sources.map(({ network, startBlock }) => [
          network.name,
          {
            address: factory({
              address: addresses,
              event: getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" }),
              parameter: "account",
            }),
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
        sources.map(({ auditor, network }) => [
          network.name,
          { address: auditor, startBlock: { [optimism.id]: 78_310_663 }[network.id] },
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
        sources.map(({ auditor, network, startBlock }) => [
          network.name,
          {
            address: factory({
              address: auditor,
              event: getAbiItem({ abi: auditorAbi, name: "MarketListed" }),
              parameter: "market",
              startBlock: { [optimism.id]: 78_310_663 }[network.id],
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
