import { env } from "node:process";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";
import { anvil } from "viem/chains";

import chain, {
  exaAccountFactoryAbi,
  factories,
  factoryChains,
  upgradeableModularAccountAbi,
} from "@exactly/common/generated/chain";

const addresses = [...factories.versions, ...factories.legacy];
const startBlock = factoryChains.get(chain.id)?.startBlock;

export default createConfig({
  database: { kind: "postgres", connectionString: env.POSTGRES_URL, poolConfig: { max: 8 } },
  chains: {
    [chain.name]: {
      id: chain.id,
      rpc: env.RPC_URL,
      ...(chain.id === anvil.id && { cacheRpcRequests: false, reorgWindow: 0 }),
    },
  },
  contracts: {
    ExaAccount: {
      chain: chain.name,
      abi: upgradeableModularAccountAbi,
      address: factory({
        address: addresses,
        event: getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" }),
        parameter: "account",
      }),
      startBlock,
    },
    ExaAccountFactory: { chain: chain.name, abi: exaAccountFactoryAbi, address: addresses, startBlock },
  },
});
