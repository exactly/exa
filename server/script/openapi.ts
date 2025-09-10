import { generateSpecs } from "hono-openapi";
import { writeFile } from "node:fs/promises";
import { padHex } from "viem";

import { version } from "../package.json";

process.env.POSTGRES_URL = "postgres";
process.env.ALCHEMY_ACTIVITY_ID = "activity";
process.env.ALCHEMY_WEBHOOKS_KEY = "webhooks";
process.env.AUTH_SECRET = "auth";
process.env.EXPO_PUBLIC_ALCHEMY_API_KEY = " ";
process.env.ISSUER_PRIVATE_KEY = padHex("0x420");
process.env.KEEPER_PRIVATE_KEY = padHex("0x420");
process.env.PANDA_API_KEY = "panda";
process.env.PANDA_API_URL = "https://panda.test";
process.env.KYC_API_KEY = "panda";
process.env.KYC_API_URL = "https://panda.test";
process.env.PERSONA_API_KEY = "persona";
process.env.PERSONA_TEMPLATE_ID = "template";
process.env.PERSONA_URL = "https://persona.test";
process.env.PERSONA_WEBHOOK_SECRET = "persona";
process.env.MANTECA_API_KEY = "manteca";
process.env.MANTECA_API_URL = "https://manteca.test";
process.env.MANTECA_WEBHOOKS_KEY = "manteca";
process.env.REDIS_URL = "redis";
process.env.SEGMENT_WRITE_KEY = "segment";

/* eslint-disable n/no-process-exit, unicorn/no-process-exit, no-console -- cli */
import("../api")
  .then(async ({ default: api }) => {
    const spec = await generateSpecs(api, {
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
            siweAuth: { type: "apiKey", in: "cookie", name: "__Secure-better-auth.session_token" },
          },
        },
      },
    });
    await writeFile("openapi.json", JSON.stringify(spec, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
/* eslint-enable n/no-process-exit, unicorn/no-process-exit, no-console */
