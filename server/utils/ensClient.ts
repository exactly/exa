import { mainnet } from "@alchemy/aa-core";
import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import { parse } from "valibot";
import { createPublicClient, http } from "viem";

import { captureRequests, Requests } from "./publicClient";

if (!mainnet.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");

export default createPublicClient({
  chain: mainnet,
  transport: http(mainnet.rpcUrls.alchemy.http[0], {
    batch: true,
    fetchOptions: {
      headers: {
        Authorization: `Bearer ${alchemyAPIKey}`,
      },
    },
    async onFetchRequest(request) {
      captureRequests(parse(Requests, await request.json()));
    },
  }),
});
