import { mainnet } from "@alchemy/aa-core";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import { parse } from "valibot";
import { createPublicClient, http } from "viem";

import { captureRequests, Requests } from "./publicClient";

export default createPublicClient({
  chain: mainnet,
  transport: http(`${mainnet.rpcUrls.alchemy?.http[0]}/${alchemyAPIKey}`, {
    batch: true,
    async onFetchRequest(request) {
      captureRequests(parse(Requests, await request.json()));
    },
  }),
});
