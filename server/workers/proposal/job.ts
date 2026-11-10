import * as v from "valibot";

import chain from "@exactly/common/generated/chain";
import ProposalType from "@exactly/common/ProposalType";
import { Address, Hex } from "@exactly/common/validation";

export const name = "proposal";
export const attempts = chain.testnet ? 3 : 20;

export type Job = {
  account: Address;
  amount: string;
  market: Address;
  retryCount: number;
  sentryBaggage?: string;
  sentryTrace?: string;
  timestamp?: number;
  unlock: string;
} & ({ data: Hex; nonce: string; proposalType: ProposalType } | { receiver: Address });

const BigIntString = v.pipe(v.union([v.string(), v.bigint()]), v.toBigint());

export const Proposal = v.object({
  account: Address,
  amount: BigIntString,
  data: Hex,
  market: Address,
  nonce: BigIntString,
  proposalType: v.enum(ProposalType),
  retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  timestamp: v.optional(v.number()),
  unlock: BigIntString,
});

export const Withdraw = v.object({
  account: Address,
  amount: BigIntString,
  market: Address,
  receiver: Address,
  retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  timestamp: v.optional(v.number()),
  unlock: BigIntString,
});

export const legacyExaPluginAbi = [
  { type: "function", name: "withdraw", inputs: [], outputs: [], stateMutability: "nonpayable" },
  {
    type: "event",
    name: "Proposed",
    inputs: [
      { name: "account", internalType: "address", type: "address", indexed: true },
      { name: "market", internalType: "contract IMarket", type: "address", indexed: true },
      { name: "receiver", internalType: "address", type: "address", indexed: true },
      { name: "amount", internalType: "uint256", type: "uint256", indexed: false },
      { name: "unlock", internalType: "uint256", type: "uint256", indexed: false },
    ],
    anonymous: false,
  },
  { type: "error", name: "NoProposal", inputs: [] },
] as const;
