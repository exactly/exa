import chain from "@exactly/common/generated/chain";

export const name = "hook";
export const attempts = chain.testnet ? 3 : 20;

export type Job = {
  receipt?: { blockNumber: number; transactionHash: string };
  sentryBaggage?: string;
  sentryTrace?: string;
};
