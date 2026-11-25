import { array, digits, number, object, pipe, string } from "valibot";

import { Address, Hash } from "@exactly/common/validation";

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

export const Check = object({
  account: Address,
  code: string(),
  timestamp: number(),
  userOpHash: Hash,
  withdraws: array(object({ assets: pipe(string(), digits()), receiver: Address })),
});
