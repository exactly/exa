import { padHex } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/anvil.ts", "test/spotlight.ts"],
    env: {
      ALCHEMY_ACTIVITY_KEY: "activity",
      ALCHEMY_BLOCK_KEY: "block",
      ALCHEMY_WEBHOOKS_KEY: "webhooks",
      AUTH_SECRET: "auth",
      COLLECTOR_ADDRESS: privateKeyToAddress(padHex("0x666")),
      EXPO_PUBLIC_ALCHEMY_API_KEY: " ",
      ISSUER_PRIVATE_KEY: padHex("0x420"),
      KEEPER_PRIVATE_KEY: padHex("0x69"),
      PANDA_API_KEY: "panda",
      PANDA_API_URL: "https://panda.test",
      PERSONA_API_KEY: "persona",
      PERSONA_TEMPLATE_ID: "template",
      PERSONA_URL: "https://persona.test",
      PERSONA_WEBHOOK_SECRET: "persona",
      POSTGRES_URL: "postgres",
      REDIS_URL: "redis",
      SEGMENT_WRITE_KEY: "segment",
    },
    coverage: { enabled: true, reporter: ["lcov"] },
    testTimeout: 36_666,
  },
});
