import { parse } from "valibot";
import { createTestClient, http, publicActions, walletActions } from "viem";
import { foundry } from "viem/chains";

import { captureRequests, Request } from "../utils/publicClient";

export default createTestClient({
  chain: foundry,
  mode: "anvil",
  transport: http(undefined, {
    async onFetchRequest(request) {
      captureRequests([parse(Request, await request.json())]);
    },
  }),
})
  .extend(publicActions)
  .extend(walletActions);
