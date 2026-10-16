import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createPanda from "../../utils/panda";
import createPax from "../../utils/pax";
import createPersona from "../../utils/persona";
import createSardine from "../../utils/sardine";
import secret from "../../utils/secret";
import createAllow from "../../workers/allow/queue";
import { connect } from "../../workers/worker";
import persona from "../persona";

const secrets = new SecretManagerServiceClient();

supervise(
  "persona",
  Promise.all([
    secret("persona-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    Promise.all([secret("persona-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
    Promise.all([
      secret("persona-pax-associate-id-key", secrets),
      secret("persona-pax-api-key", secrets),
      secret("pax-api-url", secrets),
    ]).then(([associateKey, key, url]) => createPax({ associateKey, key, url })),
    Promise.all([secret("persona-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    secret("persona-persona-webhook-secret", secrets),
    secret("redis-url", secrets)
      .then((url) => connect(url))
      .then((bullmq) => [bullmq, createAllow(bullmq)] as const),
    Promise.all([secret("persona-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
  ]).then(([database, panda, pax, provider, personaWebhookSecret, [bullmq, allow], sardine]) =>
    own(
      persona({ allow, database, panda, pax, persona: provider, personaWebhookSecret, sardine }),
      () => database.$client.end(),
      () => allow.close().finally(() => bullmq.quit()),
      () => secrets.close(),
    ),
  ),
);
