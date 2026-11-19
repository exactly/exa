import chain from "@exactly/common/generated/chain";

import type { Tenant } from "../../utils/panda";
import type { Address, Hex } from "@exactly/common/validation";

export const name = "refund";
export const attempts = chain.testnet ? 3 : 20;

export type Job = {
  account: Address;
  amount: number;
  sentryBaggage?: string;
  sentryTrace?: string;
  signature: Hex;
  tenant?: Tenant;
  timestamp: number;
};
