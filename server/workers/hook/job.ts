import chain from "@exactly/common/generated/chain";

import type { Address } from "@exactly/common/validation";

export const name = "hook";
export const attempts = chain.testnet ? 3 : 20;

export type Job = {
  account: Address;
  delivered?: string[];
  receipt?: { blockNumber: number; transactionHash: string };
  sentryBaggage?: string;
  sentryTrace?: string;
};
