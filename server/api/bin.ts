import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import api from ".";
import * as schema from "../database/schema";
import supervise, { own } from "../supervise";
import createChat from "../utils/chat";
import createIntercom from "../utils/intercom";
import createPanda from "../utils/panda";
import createPax from "../utils/pax";
import createPersona from "../utils/persona";
import createBridge from "../utils/ramps/bridge";
import createManteca from "../utils/ramps/manteca";
import createSardine from "../utils/sardine";
import secret from "../utils/secret";
import createSegment from "../utils/segment";
import createWalletExtension from "../utils/walletExtension";
import createCredit from "../workers/credit/queue";
import createSubscribe from "../workers/subscribe/queue";
import { connect } from "../workers/worker";

const secrets = new SecretManagerServiceClient();

supervise(
  "api",
  Promise.all([
    secret("redis-url", secrets).then((url) => {
      const bullmq = connect(url);
      return [new Redis(url), bullmq, createCredit(bullmq), createSubscribe(bullmq)] as const;
    }),
    secret("api-auth-secret", secrets),
    Promise.all([secret("api-bridge-api-key", secrets), secret("bridge-api-url", secrets)]).then(([key, url]) =>
      createBridge(key, url),
    ),
    secret("chat-identity-key", secrets).then(createChat),
    secret("api-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("api-intercom-identity-key", secrets).then((key) => createIntercom(key)),
    Promise.all([secret("api-manteca-api-key", secrets), secret("manteca-api-url", secrets)]).then(([key, url]) =>
      createManteca(key, url),
    ),
    Promise.all([secret("api-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
    Promise.all([
      secret("api-pax-associate-id-key", secrets),
      secret("api-pax-api-key", secrets),
      secret("pax-api-url", secrets),
    ]).then(([associateKey, key, url]) => createPax({ associateKey, key, url })),
    Promise.all([secret("api-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    Promise.all([secret("api-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
    secret("api-segment-write-key", secrets).then((key) => createSegment(key)),
    secret("api-wallet-extension-secret", secrets).then((value) => createWalletExtension(value)),
  ]).then(
    ([
      [redis, bullmq, credit, subscribe],
      authSecret,
      bridge,
      chat,
      database,
      intercom,
      manteca,
      panda,
      pax,
      persona,
      sardine,
      segment,
      walletExtension,
    ]) =>
      own(
        api({
          authSecret,
          bridge,
          chat,
          credit,
          database,
          intercom,
          manteca,
          panda,
          pax,
          persona,
          redis,
          sardine,
          segment,
          subscribe,
          walletExtension,
        }),
        () => database.$client.end(),
        () => redis.quit(),
        () => secrets.close(),
        () => segment.close(),
        () => Promise.all([credit.close(), subscribe.close()]).finally(() => bullmq.quit()),
      ),
  ),
);
