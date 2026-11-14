import { env } from "node:process";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { anvil, base, moonbeamDev, optimism } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, {
  alchemyChains,
  auditorAbi,
  exaAccountFactoryAbi,
  exaPluginAbi,
  factories,
  marketAbi,
  networks,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";

const addresses = [...factories.versions, ...factories.legacy];
const sources = [...networks].map(([id, { auditor }]) => {
  const network = id === chain.id ? chain : alchemyChains.get(id);
  const rpc = network?.rpcUrls.alchemy.http[0];
  if (!network || !rpc) throw new Error(`missing network ${id}`);
  return {
    auditor,
    network,
    rpc: `${rpc}/${alchemyAPIKey}`,
    startBlock: { [optimism.id]: 123_125_164, [base.id]: 38_143_182 }[id],
  };
});

export default createConfig({
  database: { kind: "postgres", connectionString: env.POSTGRES_URL, poolConfig: { max: 8 } },
  chains: Object.fromEntries(
    sources.map(({ network, rpc }) => [
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
    ProposalManager: {
      abi: proposalManagerAbi,
      chain: Object.fromEntries(sources.map(({ network, startBlock }) => [network.name, { startBlock }])),
    },
  },
});
