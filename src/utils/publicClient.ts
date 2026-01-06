import { alchemy, createAlchemyPublicRpcClient } from "@account-kit/infra";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { http } from "viem";

export default createAlchemyPublicRpcClient({
  chain,
  transport: alchemyAPIKey ? alchemy({ apiKey: alchemyAPIKey }) : (http() as never),
});
