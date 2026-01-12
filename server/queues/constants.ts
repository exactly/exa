export const QueueName = {
  ALCHEMY: "alchemy",
  MATURITY: "maturity-notifications",
} as const;

export type QueueNameEnum = (typeof QueueName)[keyof typeof QueueName];

export const AlchemyJob = {
  ADD_SUBSCRIBER: "add-subscriber",
} as const;

export type AlchemyJobEnum = (typeof AlchemyJob)[keyof typeof AlchemyJob];

export const MaturityJob = {
  CHECK_DEBTS: "check-debts",
} as const;

export type MaturityJobEnum = (typeof MaturityJob)[keyof typeof MaturityJob];
