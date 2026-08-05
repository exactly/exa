import { drizzle } from "drizzle-orm/node-postgres";
import { generateSpecs } from "hono-openapi";
import { Redis } from "ioredis";
import { writeFile } from "node:fs/promises";
import { zeroHash } from "viem";

import * as schema from "../database/schema";
import { version } from "../package.json";
import createChat from "../utils/chat";
import createIntercom from "../utils/intercom";
import createPanda from "../utils/panda";
import createPax from "../utils/pax";
import createPersona from "../utils/persona";
import createBridge from "../utils/ramps/bridge";
import createManteca from "../utils/ramps/manteca";
import createSardine from "../utils/sardine";
import createSegment from "../utils/segment";
import createWalletExtension from "../utils/walletExtension";

/* eslint-disable n/no-process-exit, unicorn/no-process-exit, no-console -- cli */
import("../api")
  .then(async ({ default: api }) => {
    const database = drizzle("postgres", { schema });
    const redis = new Redis({ lazyConnect: true });
    const segment = createSegment("segment");
    const handle = api({
      authSecret: zeroHash,
      bridge: createBridge("bridge", "https://bridge.test"),
      chat: createChat(zeroHash),
      credit: { close: () => Promise.resolve(), enqueue: () => Promise.resolve() },
      database,
      intercom: createIntercom("intercom"),
      manteca: createManteca("manteca", "https://manteca.test"),
      panda: createPanda({ key: "panda", url: "https://panda.test" }),
      pax: createPax({ associateKey: "pax", key: "pax", url: "https://pax.test" }),
      persona: createPersona("persona", "https://persona.test"),
      redis,
      sardine: createSardine("sardine", "https://api.sardine.ai"),
      segment,
      subscribe: { close: () => Promise.resolve(), enqueue: () => Promise.resolve() },
      walletExtension: createWalletExtension(zeroHash),
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
    redis.disconnect();
    await Promise.all([database.$client.end(), segment.close()]);
    process.exit(0);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
/* eslint-enable n/no-process-exit, unicorn/no-process-exit, no-console */
