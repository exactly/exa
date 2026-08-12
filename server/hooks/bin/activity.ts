import supervise from "../../supervise";
import secret from "../../utils/secret";
import activity from "../activity";

supervise(
  "activity",
  Promise.all([
    secret("activity-alchemy-webhooks-key"),
    secret("activity-onesignal-api-key"),
    secret("activity-postgres-url"),
    secret("redis-url"),
  ]).then(([alchemyKey, onesignalKey, postgresUrl, redisUrl]) =>
    activity({ alchemyKey, onesignalKey, postgresUrl, redisUrl }),
  ),
);
