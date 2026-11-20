import type { Address, Hex } from "@exactly/common/validation";

export const name = "poke";
export const attempts = 10;

export type Job = {
  account: Address;
  assets?: Address[];
  chainId: number;
  delayedAt?: number;
  factory: Address;
  origin: "activity" | "allow";
  publicKey: Hex;
  salt: Address;
  sentryBaggage?: string;
  sentryTrace?: string;
  source: null | string;
  stuck?: true;
  unaffordable?: true;
};
