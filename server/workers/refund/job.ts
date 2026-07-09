export const name = "refund";
export const attempts = 10;

export type Job = {
  amount: `${bigint}`;
  sentryBaggage?: string;
  sentryTrace?: string;
};
