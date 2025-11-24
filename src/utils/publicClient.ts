import { createAlchemyPublicRpcClient } from "@alchemy/aa-alchemy";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

export default createAlchemyPublicRpcClient({ chain, connectionConfig: { apiKey: alchemyAPIKey ?? "" } });
