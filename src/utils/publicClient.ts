import { alchemy, createAlchemyPublicRpcClient } from "@account-kit/infra";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

export default createAlchemyPublicRpcClient({ chain, transport: alchemy({ apiKey: alchemyAPIKey }) });
