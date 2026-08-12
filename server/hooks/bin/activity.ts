import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import createOnesignal from "../../utils/onesignal";
import secret from "../../utils/secret";
import createPoke from "../../workers/poke/queue";
import { connect } from "../../workers/worker";
import activity from "../activity";

const secrets = new SecretManagerServiceClient();

supervise(
  "activity",
  Promise.all([
    secret("activity-alchemy-webhooks-key", secrets).then((key) => createAlchemy(key)),
    secret("activity-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("activity-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    secret("redis-url", secrets)
      .then((url) => [new Redis(url), connect(url)] as const)
      .then(([redis, bullmq]) => [redis, bullmq, createPoke(bullmq)] as const),
  ]).then(([alchemy, database, onesignal, [redis, bullmq, poke]]) =>
    own(
      activity({ alchemy, database, onesignal, poke, redis }),
      () => database.$client.end(),
      () => poke.close().finally(() => bullmq.quit()),
      () => redis.quit(),
      () => secrets.close(),
    ),
  ),
);
