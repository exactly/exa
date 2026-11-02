import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import createOnesignal from "../../utils/onesignal";
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
    secret("block-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    secret("redis-url", secrets).then((url) => new Redis(url)),
  ]).then(([alchemy, blockKey, database, executor, onesignal, redis]) =>
    own(
      block({ alchemy, blockKey, database, executor, onesignal, redis }),
      () => database.$client.end(),
      () => kms.close(),
      () => redis.quit(),
      () => secrets.close(),
    ),
  ),
);
