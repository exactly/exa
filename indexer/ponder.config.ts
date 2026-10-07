import { env } from "node:process";
import { createConfig, factory } from "ponder";
import { getAbiItem } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { exaAccountFactoryAbi, factories, upgradeableModularAccountAbi } from "@exactly/common/generated/chain";

const addresses = [...factories.versions, ...factories.legacy];

export default createConfig({
  database: { kind: "postgres", connectionString: env.POSTGRES_URL },
  chains: { [chain.name]: { id: chain.id, rpc: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}` } },
  contracts: {
    ExaAccount: {
      chain: chain.name,
      abi: upgradeableModularAccountAbi,
      address: factory({
        address: addresses,
        event: getAbiItem({ abi: exaAccountFactoryAbi, name: "ExaAccountInitialized" }),
        parameter: "account",
      }),
    },
    ExaAccountFactory: { chain: chain.name, abi: exaAccountFactoryAbi, address: addresses },
  },
});
