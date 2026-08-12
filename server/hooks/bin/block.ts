import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import createOnesignal from "../../utils/onesignal";
import createPersona from "../../utils/persona";
import createManteca from "../../utils/ramps/manteca";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import block from "../block";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  "block",
  Promise.all([
    secret("block-alchemy-webhooks-key", secrets).then((key) => createAlchemy(key)),
    secret("block-alchemy-block-key", secrets),
    secret("block-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    signer("executor", kms),
    Promise.all([secret("block-manteca-api-key", secrets), secret("manteca-api-url", secrets)]).then(([key, url]) =>
      createManteca(key, url),
    ),
    secret("block-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    Promise.all([secret("block-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    secret("redis-url", secrets).then((url) => new Redis(url)),
  ]).then(([alchemy, blockKey, database, executor, manteca, onesignal, persona, redis]) =>
    own(
      block({ alchemy, blockKey, database, executor, manteca, onesignal, persona, redis }),
      () => database.$client.end(),
      () => kms.close(),
      () => redis.quit(),
      () => secrets.close(),
    ),
  ),
);
