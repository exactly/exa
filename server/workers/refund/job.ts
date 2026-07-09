export const name = "refund";
export const attempts = 10;

export type Job = {
  sentryBaggage?: string;
  sentryTrace?: string;
};
