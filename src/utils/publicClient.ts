import { createAlchemyPublicRpcClient } from "@alchemy/aa-alchemy";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

if (!chain.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");

export default createAlchemyPublicRpcClient({
  connectionConfig: { jwt: alchemyAPIKey, rpcUrl: chain.rpcUrls.alchemy.http[0] },
  chain,
});
