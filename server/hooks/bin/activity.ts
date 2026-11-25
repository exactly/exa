import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { Redis } from "ioredis";

import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import { publisher } from "../../utils/events";
import createOnesignal from "../../utils/onesignal";
import { databases, end } from "../../utils/postgres";
import secret from "../../utils/secret";
import createPoke from "../../workers/poke/queue";
import activity from "../activity";

const secrets = new SecretManagerServiceClient();

supervise(
  "activity",
  Promise.all([
    secret("activity-alchemy-webhooks-key", secrets).then((key) => createAlchemy(key)),
    databases("activity", secrets),
    secret("activity-onesignal-api-keys", secrets).then((key) => createOnesignal(key)),
    secret("redis-url", secrets)
      .then((url) => new Redis(url))
      .then((redis) => [redis, createPoke(redis)] as const),
  ]).then(([alchemy, { database, views }, onesignal, [redis, poke]]) =>
    own(
      activity({ alchemy, database: publisher(database), onesignal, poke, redis, views }),
      () => end(database, views),
      () => poke.close().finally(() => redis.quit()),
      () => secrets.close(),
    ),
  ),
);
