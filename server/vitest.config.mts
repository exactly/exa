import { env } from "node:process";
import { padHex } from "viem";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["test/anvil.ts", "test/database.ts", "test/spotlight.ts"],
    coverage: { enabled: true, reporter: ["lcov"] },
    reporters: ["default", "junit"],
    outputFile: { junit: "coverage/junit.xml" },
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
      INTERCOM_IDENTITY_KEY: "a9cBeTfEtGPSQ58REZP35Bx00ofajvStEc8TTuBtSmk",
      ISSUER_PRIVATE_KEY: padHex("0x420"),
      MANTECA_API_URL: "https://manteca.test",
      MANTECA_API_KEY: "manteca",
      MANTECA_WEBHOOKS_KEY: "manteca",
      KEEPER_PRIVATE_KEY: padHex("0x69"),
      PANDA_API_KEY: "panda",
      PANDA_API_URL: "https://panda.test",
      PANDA_E2E_PRIVATE_KEY: `-----BEGIN PRIVATE KEY-----
MIICdgIBADANBgkqhkiG9w0BAQEFAASCAmAwggJcAgEAAoGBAK7Zg545uRpiJCZz
j23YKeTyzIDVQGoUExWGQlfK5ID1/6EYLbZ9eBC2l8CNCYVGm3mrh/qLSsbZtSLw
qbSNkQt0PpcrPrf+GnnbZ9vE2447Gzft2Uf0HeTpbw1COMONoWEDAKx6+ru4BJfA
QQrc2lXsMQ+Ul7pzwJDT5CpNPLZnAgMBAAECgYA7bxqLPSnLaxLIsz1M5E6RUWrs
XBCyPjKifWmtt/zmTThghPx87LdUTwzUWdyjnfWZbRIiuxhm8Xfd8ZpuEjT79H0j
4GT12UOFlKAvi2lXdqn7IBFIkdVC3kS6wFUFbHKTGwiVDUP/l9z92POPEV+cIpAh
rf1q7VYxoOXU2+RBUQJBAORq7ebGfLgnvNp49o8bSUcNxbhola7jpRCKOt2oexAM
B3SmvX/hPlthst3Lcpa/vYE5VFvLqa1DnObBoDWwvV8CQQDD9qM9W7HmMgByUv9S
3Fs/Qqqe7dhIlcXD3mLjby2vxH5qE1+okNgFcTgJ/G0oacFz3uUhbvYAqFWU3LIh
1Jv5AkBB11zKF87dmn7CjvmrWJcvxxWGSYdUCUSMVvwO5sDKaF1Bz8px8TBzUN8p
NbrLH2v1stvRNgyr6ABzN78BmveLAkEAqMVzA7ZEOghYYB3hLgEASTRmdChN/P2Y
7L9MFaq8A0RMx5jV6vyMP+upotgXPxYN+Xg/iJLjJd/UjTeh5wcQKQJAKkzcVyZw
OEW5okJDZmmfTeh96WBhKGaOczZuuYn88I3A6cKj1p8Yc7UZ1X8vvztY5P7N0YbL
VuNOZKwaXFtqgA==
-----END PRIVATE KEY-----`,
      PAX_API_KEY: "pax",
      PAX_API_URL: "https://pax.test",
      PAX_ASSOCIATE_ID_KEY: "pax",
      PERSONA_API_KEY: "persona",
      PERSONA_URL: "https://persona.test",
      BRIDGE_WEBHOOK_PUBLIC_KEY: `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4f9QAuHfZxnrz+xXumvm
3aHoAobU+aASjBn0d0UVKb5tGAd765+Ic7pyQEWcxjjAH1xQ/lVdpg0ny0QrWZSV
FIWZm4jEt0ga/bWiB/5FnSk9OHEYwyIvzkUHp7VZf2PxGuT3LGxtk/yv/sMnZlE2
nUkuPAVatx4t6MA6+jvjLADT3Lh3YIzlf87Gd8PdofY484S6YJteyJkT7ntfI+S/
4XyFzQN7b1sSdLBSCsur+jc3Mib0tSQSr8mUf9TGrcB5yRGjEP7TJgMh7PfImEbq
lX1hy8J7j7dpYYxGXZcUQuTL++du99Q9yxG/0oFrE9ILwqYZJScOlcAulfICkevJ
YQIDAQAB
-----END PUBLIC KEY-----`,
      PERSONA_WEBHOOK_SECRET: "persona",
      POSTGRES_URL: "postgres://postgres:postgres@localhost:8432/postgres?sslmode=disable", // cspell:ignore sslmode
      REDIS_URL: "redis",
      SARDINE_API_KEY: "sardine",
      SARDINE_API_URL: "https://api.sardine.ai",
      SEGMENT_WRITE_KEY: "segment",
      ...(env.NODE_ENV === "e2e" && { APP_DOMAIN: "localhost", DEBUG: "exa:*" }),
    },
    ...(env.NODE_ENV === "e2e" && {
      include: ["test/e2e.ts"],
      disableConsoleIntercept: true,
      reporters: [["default", { summary: false }], "junit"],
    }),
  },
});
