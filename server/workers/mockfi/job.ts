import type { Address, Hash, Hex } from "@exactly/common/validation";

export const name = "mockfi";
export const attempts = 10;

export type Job = {
  amount: string;
  asset: Address;
  chainId: number;
  receiver: Address;
  sentryBaggage?: string;
  sentryTrace?: string;
  source: { chainId: number; hash: Hash };
  transactionId: Hex;
};
