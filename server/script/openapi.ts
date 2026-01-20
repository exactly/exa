import { generateSpecs } from "hono-openapi";
import { writeFile } from "node:fs/promises";
import { padHex } from "viem";

import { version } from "../package.json";

process.env.ALCHEMY_ACTIVITY_ID = "activity";
process.env.ALCHEMY_WEBHOOKS_KEY = "webhooks";
process.env.AUTH_SECRET = "auth";
process.env.BRIDGE_API_KEY = "bridge";
process.env.BRIDGE_API_URL = "https://bridge.test";
process.env.EXPO_PUBLIC_ALCHEMY_API_KEY = " ";
process.env.INTERCOM_IDENTITY_KEY = "intercom";
process.env.ISSUER_PRIVATE_KEY = padHex("0x420");
process.env.KEEPER_PRIVATE_KEY = padHex("0x420");
process.env.MANTECA_API_KEY = "manteca";
process.env.MANTECA_API_URL = "https://manteca.test";
process.env.MANTECA_WEBHOOKS_KEY = "manteca";
process.env.PANDA_API_KEY = "panda";
process.env.PANDA_API_URL = "https://panda.test";
process.env.PAX_API_KEY = "pax";
process.env.PAX_API_URL = "https://pax.test";
process.env.PAX_ASSOCIATE_ID_KEY = "pax";
process.env.PERSONA_API_KEY = "persona";
process.env.PERSONA_URL = "https://persona.test";
process.env.PERSONA_WEBHOOK_SECRET = "persona";
process.env.POSTGRES_URL = "postgres";
process.env.REDIS_URL = "redis";
process.env.SARDINE_API_KEY = "sardine";
process.env.SARDINE_API_URL = "https://api.sardine.ai";
process.env.SEGMENT_WRITE_KEY = "segment";
process.env.GCP_BASE64_JSON = "base64String==";
process.env.GOOGLE_APPLICATION_CREDENTIALS = "path/to/credentials.json";
process.env.GCP_KMS_KEY_RING = "op-sepolia";
process.env.GCP_KMS_KEY_VERSION = "1";
process.env.GCP_PROJECT_ID = "exa-dev";

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
          },
        },
      },
    });
    await writeFile("generated/openapi.json", JSON.stringify(spec, null, 2));
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
/* eslint-enable n/no-process-exit, unicorn/no-process-exit, no-console */
