import { createTestClient, http, publicActions, walletActions } from "viem";
import { foundry, optimism } from "viem/chains";

export default createTestClient({
  chain: { ...foundry, blockTime: optimism.blockTime },
  mode: "anvil",
  transport: http(),
})
  .extend(publicActions)
  .extend(walletActions);
