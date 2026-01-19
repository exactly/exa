import { alchemy, createAlchemyPublicRpcClient } from "@account-kit/infra";
import { http } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

export default createAlchemyPublicRpcClient({
  chain,
  transport: alchemyAPIKey ? alchemy({ apiKey: alchemyAPIKey }) : (http() as never),
});
