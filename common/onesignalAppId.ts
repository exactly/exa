import domain from "./domain";

export default (process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID || // eslint-disable-line @typescript-eslint/prefer-nullish-coalescing -- ignore empty string
  {
    "web.exactly.app": "31d4be98-1fa3-4a8c-9657-dc21c991adc7",
    "base.exactly.app": "9f896065-637d-455c-baff-4041268dafce",
    "sandbox.exactly.app": "15bd3cf9-f71e-43f2-96ff-e76916a832a3",
    "base-sepolia.exactly.app": "893d33c6-d1bd-46cb-9047-d4d524f384f0",
  }[domain]) ??
  "2f79a35c-8b11-4725-84d8-fc096f3f216e";
