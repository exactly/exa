import { env } from "node:process";
import { padHex } from "viem";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/anvil.ts", "test/database.ts", "test/spotlight.ts"],
    coverage: { enabled: true, reporter: ["lcov"] },
    testTimeout: 36_666,
    hookTimeout: 36_666,
    env: {
      ALCHEMY_ACTIVITY_ID: "activity",
      ALCHEMY_ACTIVITY_KEY: "activity",
      ALCHEMY_BLOCK_KEY: "block",
      ALCHEMY_WEBHOOKS_KEY: "webhooks",
      AUTH_SECRET: "auth",
      BRIDGE_API_KEY: "bridge",
      BRIDGE_API_URL: "https://bridge.test",
      EXPO_PUBLIC_ALCHEMY_API_KEY: " ",
      INTERCOM_IDENTITY_KEY: "intercom",
      ISSUER_PRIVATE_KEY: padHex("0x420"),
      MANTECA_API_URL: "https://manteca.test",
      MANTECA_API_KEY: "manteca",
      MANTECA_WEBHOOKS_KEY: "manteca",
      KEEPER_PRIVATE_KEY: padHex("0x69"),
      PANDA_API_KEY: "panda",
      PANDA_API_URL: "https://panda.test",
      PAX_API_KEY: "pax",
      PAX_API_URL: "https://pax.test",
      PAX_ASSOCIATE_ID_KEY: "pax",
      PERSONA_API_KEY: "persona",
      PERSONA_URL: "https://persona.test",
      PERSONA_WEBHOOK_SECRET: "persona",
      POSTGRES_URL: "postgres://postgres:postgres@localhost:8432/postgres?sslmode=disable", // cspell:ignore sslmode
      REDIS_URL: "redis",
      SARDINE_API_KEY: "sardine",
      SARDINE_API_URL: "https://api.sardine.ai",
      SEGMENT_WRITE_KEY: "segment",
      GCP_KMS_KEY_RING: "op-sepolia",
      GCP_KMS_KEY_VERSION: "1",
      GCP_PROJECT_ID: "exa-dev",
      GCP_BASE64_JSON: "WlhsS01HVllRbXhKYW05blNXNU9iR051V25CWk1sWm1XVmRPYW1JelZuVmtRMG81UTJjOVBRbz0K",
      ...(env.NODE_ENV === "e2e" && { APP_DOMAIN: "localhost", DEBUG: "exa:*" }),
    },
    ...(env.NODE_ENV === "e2e" && {
      include: ["test/e2e.ts"],
      disableConsoleIntercept: true,
      reporters: [["default", { summary: false }]],
    }),
  },
});
