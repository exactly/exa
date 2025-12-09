import domain from "@exactly/common/domain";

export default (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  { "web.exactly.app": "31d4be98-1fa3-4a8c-9657-dc21c991adc7" }[domain]) ??
  "15bd3cf9-f71e-43f2-96ff-e76916a832a3";
