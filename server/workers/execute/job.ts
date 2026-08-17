import * as v from "valibot";

import ProposalType from "@exactly/common/ProposalType";
import { Address, Hex } from "@exactly/common/validation";

export const name = "execute";
export const attempts = 10;

export const Proposal = v.object({
  account: Address,
  amount: v.bigint(),
  data: Hex,
  market: Address,
  nonce: v.bigint(),
  proposalType: v.enum(ProposalType),
  retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  timestamp: v.optional(v.number()),
  unlock: v.bigint(),
});

export type Proposal = v.InferOutput<typeof Proposal>;
export type Job = Omit<Proposal, "amount" | "nonce" | "unlock"> & {
  amount: string;
  nonce: string;
  sentryBaggage?: string;
  sentryTrace?: string;
  unlock: string;
};
