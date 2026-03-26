import { base } from "viem/chains";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import alchemyGasPolicyId from "@exactly/common/alchemyGasPolicyId";
import chain from "@exactly/common/generated/chain";

export const capabilities =
  chain.id === base.id
    ? undefined
    : {
        paymasterService: {
          optional: true,
          url: `${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`,
          context: { policyId: alchemyGasPolicyId },
        },
      };
