import type { ExaAPI } from "@exactly/server/api";
import { hc } from "hono/client";

export function createAPIClient(baseURL: string): ReturnType<typeof hc<ExaAPI>> {
  return hc<ExaAPI>(baseURL, { init: { credentials: "include" } });
}

export type {
  CreditActivity,
  DebitActivity,
  DepositActivity,
  InstallmentsActivity,
  OnchainActivity,
  PandaActivity,
  RepayActivity,
  WithdrawActivity,
} from "@exactly/server/api/activity";
