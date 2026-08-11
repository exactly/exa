import { generateSpecs } from "hono-openapi";
import { writeFile } from "node:fs/promises";
import { zeroHash } from "viem";

import { version } from "../package.json";

/* eslint-disable n/no-process-exit, unicorn/no-process-exit, no-console -- cli */
import("../api")
  .then(async ({ default: api }) => {
    const handle = api({
      alchemyKey: "webhooks",
      authSecret: zeroHash,
      bridgeKey: "bridge",
      bridgeUrl: "https://bridge.test",
      intercomKey: "intercom",
      mantecaKey: "manteca",
      mantecaUrl: "https://manteca.test",
      pandaKey: "panda",
      pandaUrl: "https://panda.test",
      paxAssociateKey: "pax",
      paxKey: "pax",
      paxUrl: "https://pax.test",
      personaKey: "persona",
      personaUrl: "https://persona.test",
      postgresUrl: "postgres",
      redisUrl: "redis",
      sardineKey: "sardine",
      sardineUrl: "https://api.sardine.ai",
      segmentKey: "segment",
      walletExtensionSecret: zeroHash,
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
