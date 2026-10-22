import { encodeEventTopics } from "viem";

import { proposalManagerAbi } from "@exactly/common/generated/hooks";

import type { WalletCallReceipt } from "viem";

export default function decodeProposal(receipt: WalletCallReceipt<bigint, "reverted" | "success">) {
  const [topic] = encodeEventTopics({ abi: proposalManagerAbi, eventName: "Proposed" });
  const nonce = receipt.logs.find(({ topics }) => topics[0] === topic)?.topics[2];
  return nonce ? { nonce: BigInt(nonce), since: receipt.blockNumber } : undefined;
}
