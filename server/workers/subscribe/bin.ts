import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";

supervise(
  name,
  Promise.all([secret("account-alchemy-webhooks-key"), secret("redis-url")]).then(([alchemyKey, redisUrl]) =>
    worker({ alchemyKey, redisUrl }),
  ),
);
