import supervise from "../../supervise";
import secret from "../../utils/secret";
import block from "../block";

supervise(
  "block",
  Promise.all([secret("block-alchemy-webhooks-key"), secret("redis-url")]).then(([alchemyKey, redisUrl]) =>
    block({ alchemyKey, redisUrl }),
  ),
);
