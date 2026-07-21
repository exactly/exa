import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";

supervise(
  name,
  Promise.all([secret("credit-onesignal-api-key"), secret("credit-postgres-url"), secret("redis-url")]).then(
    ([onesignalKey, postgresUrl, redisUrl]) => worker({ onesignalKey, postgresUrl, redisUrl }),
  ),
);
