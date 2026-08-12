import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import block from "../block";

supervise(
  "block",
  Promise.all([
    secret("block-alchemy-webhooks-key"),
    secret("block-onesignal-api-key"),
    secret("redis-url"),
    signer("executor"),
  ]).then(([alchemyKey, onesignalKey, redisUrl, executor]) => block({ alchemyKey, executor, onesignalKey, redisUrl })),
);
