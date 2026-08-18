import * as v from "valibot";

import ProposalType from "@exactly/common/ProposalType";
import { Address, Hex } from "@exactly/common/validation";

export const name = "execute";
export const attempts = 10;

const Execute = v.object({
  account: Address,
  amount: v.bigint(),
  data: Hex,
  functionName: v.literal("executeProposal"),
  market: Address,
  nonce: v.bigint(),
  proposalType: v.enum(ProposalType),
  retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  timestamp: v.optional(v.number()),
  unlock: v.bigint(),
});
export const Withdraw = v.object({
  account: Address,
  amount: v.bigint(),
  functionName: v.literal("withdraw"),
  market: Address,
  receiver: Address,
  retryCount: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0)), 0),
  timestamp: v.optional(v.number()),
  unlock: v.bigint(),
});

export const Proposal = v.variant("functionName", [Execute, Withdraw]);

export type Proposal = v.InferOutput<typeof Proposal>;
export type Job = (
  | (Omit<v.InferOutput<typeof Execute>, "amount" | "nonce" | "unlock"> & {
      amount: string;
      nonce: string;
      unlock: string;
    })
  | (Omit<v.InferOutput<typeof Withdraw>, "amount" | "unlock"> & { amount: string; unlock: string })
) & { sentryBaggage?: string; sentryTrace?: string };
