import type { Address } from "@exactly/common/validation";

export const name = "qr";
export const attempts = 7 * 24 * 6;

export type Job = {
  account: Address;
  code: string;
  sentryBaggage?: string;
  sentryTrace?: string;
  timestamp: number;
  withdraws: { assets: string; receiver: Address }[];
};
