export const name = "chat";
export const attempts = 10;

export type Job = {
  contact?: string;
  from: string;
  phoneNumberId: string;
  sentryBaggage?: string;
  sentryTrace?: string;
  text: string;
};
