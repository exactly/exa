import type { Address, Hex } from "@exactly/common/validation";

export const name = "poke";
export const attempts = 10;

export type Job = {
  account: Address;
  assets?: Address[];
  chainId: number;
  factory: Address;
  origin: "activity" | "allow";
  pending?: Address[];
  publicKey: Hex;
  sentryBaggage?: string;
  sentryTrace?: string;
  source: null | string;
};
