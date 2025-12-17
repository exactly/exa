export const QueueName = {
  ALCHEMY: "alchemy",
} as const;

export type QueueNameEnum = (typeof QueueName)[keyof typeof QueueName];

export const AlchemyJob = {
  ADD_SUBSCRIBER: "add-subscriber",
} as const;

export type AlchemyJobEnum = (typeof AlchemyJob)[keyof typeof AlchemyJob];
