export const name = "replication";
export const attempts = 1;

export type Job = {
  sentryBaggage?: string;
  sentryTrace?: string;
};
