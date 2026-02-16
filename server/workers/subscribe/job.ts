import type { Address } from "@exactly/common/validation";

export const name = "subscribe";
export const attempts = 10;

export type Job = {
  account: Address;
  sentryBaggage?: string;
  sentryTrace?: string;
};
