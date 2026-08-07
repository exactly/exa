import { generateSpecs } from "hono-openapi";
import { writeFile } from "node:fs/promises";
import { env } from "node:process";
import { nonEmpty, parse, pipe, string } from "valibot";
import { padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { version } from "../package.json";

env.ALCHEMY_ACTIVITY_ID = "activity";
env.ALCHEMY_WEBHOOKS_KEY = "webhooks";
env.AUTH_SECRET = zeroHash;
env.BRIDGE_API_KEY = "bridge";
env.BRIDGE_API_URL = "https://bridge.test";
env.EXPO_PUBLIC_ALCHEMY_API_KEY = " ";
env.INTERCOM_IDENTITY_KEY = "intercom";
env.ISSUER_PRIVATE_KEY = padHex("0x420");
env.KEEPER_PRIVATE_KEY = padHex("0x420");
env.MANTECA_API_KEY = "manteca";
env.MANTECA_API_URL = "https://manteca.test";
env.MANTECA_WEBHOOKS_KEY = "manteca";
env.PANDA_API_KEY = "panda";
env.PANDA_API_URL = "https://panda.test";
env.ISSUER_ADDRESS = privateKeyToAddress(padHex("0x420"));
env.PAX_API_KEY = "pax";
env.PAX_API_URL = "https://pax.test";
env.PAX_ASSOCIATE_ID_KEY = "pax";
env.PERSONA_API_KEY = "persona";
env.PERSONA_URL = "https://persona.test";
env.PERSONA_WEBHOOK_SECRET = "persona";
env.POSTGRES_URL = "postgres";
env.REDIS_URL = "redis";
env.SARDINE_API_KEY = "sardine";
env.SARDINE_API_URL = "https://api.sardine.ai";
env.SEGMENT_WRITE_KEY = "segment";
env.WALLET_EXTENSION_SECRET = zeroHash;

/* eslint-disable n/no-process-exit, unicorn/no-process-exit, no-console -- cli */
import("../api")
  .then(async ({ default: api }) => {
    const handle = api({
      alchemyKey: parse(pipe(string(), nonEmpty()), env.ALCHEMY_WEBHOOKS_KEY),
      authSecret: parse(pipe(string(), nonEmpty()), env.AUTH_SECRET),
      bridgeKey: parse(pipe(string(), nonEmpty()), env.BRIDGE_API_KEY),
      bridgeUrl: parse(pipe(string(), nonEmpty()), env.BRIDGE_API_URL),
      intercomKey: parse(pipe(string(), nonEmpty()), env.INTERCOM_IDENTITY_KEY),
      mantecaKey: parse(pipe(string(), nonEmpty()), env.MANTECA_API_KEY),
      mantecaUrl: parse(pipe(string(), nonEmpty()), env.MANTECA_API_URL),
      pandaKey: parse(pipe(string(), nonEmpty()), env.PANDA_API_KEY),
      pandaUrl: parse(pipe(string(), nonEmpty()), env.PANDA_API_URL),
      paxAssociateKey: parse(pipe(string(), nonEmpty()), env.PAX_ASSOCIATE_ID_KEY),
      paxKey: parse(pipe(string(), nonEmpty()), env.PAX_API_KEY),
      paxUrl: parse(pipe(string(), nonEmpty()), env.PAX_API_URL),
      personaKey: parse(pipe(string(), nonEmpty()), env.PERSONA_API_KEY),
      personaUrl: parse(pipe(string(), nonEmpty()), env.PERSONA_URL),
      postgresUrl: parse(pipe(string(), nonEmpty()), env.POSTGRES_URL),
      redisUrl: parse(pipe(string(), nonEmpty()), env.REDIS_URL),
      sardineKey: parse(pipe(string(), nonEmpty()), env.SARDINE_API_KEY),
      sardineUrl: parse(pipe(string(), nonEmpty()), env.SARDINE_API_URL),
      segmentKey: parse(pipe(string(), nonEmpty()), env.SEGMENT_WRITE_KEY),
      walletExtensionSecret: parse(pipe(string(), nonEmpty()), env.WALLET_EXTENSION_SECRET),
    });
    const spec = await generateSpecs(handle.app, {
      documentation: {
        info: { version, title: "Exa API" },
        servers: [
          { url: "https://web.exactly.app/api", description: "Production" },
          { url: "https://sandbox.exactly.app/api", description: "Sandbox" },
        ],
        components: {
          securitySchemes: {
            credentialAuth: {
              type: "apiKey",
              in: "cookie",
              name: "credential_id",
            },
            extensionAuth: { type: "http", scheme: "bearer" },
            siweAuth: { type: "apiKey", in: "cookie", name: "__Secure-better-auth.session_token" },
          },
        },
      },
    });
    await writeFile("generated/openapi.json", JSON.stringify(spec, null, 2));
    await handle.close();
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
/* eslint-enable n/no-process-exit, unicorn/no-process-exit, no-console */
