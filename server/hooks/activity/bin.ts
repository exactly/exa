import { Hono } from "hono";

import supervise from "../../supervise";
import secret from "../../utils/secret";
import activity from "../activity";

const app = new Hono();

supervise(
  "activity",
  Promise.all([
    secret("activity-alchemy-webhooks-key"),
    secret("activity-onesignal-api-key"),
    secret("activity-postgres-url"),
    secret("redis-url"),
  ]).then(([alchemyKey, onesignalKey, postgresUrl, redisUrl]) => {
    const hook = activity({ alchemyKey, onesignalKey, postgresUrl, redisUrl });
    app.route("/hooks/activity", hook.app);
    return hook;
  }),
  app,
);
