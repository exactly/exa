import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([
    secret("poke-onesignal-api-key"),
    secret("redis-url"),
    secret("poke-segment-write-key"),
    signer("poker"),
  ]).then(([onesignalKey, redisUrl, segmentKey, poker]) => worker({ onesignalKey, poker, redisUrl, segmentKey })),
);
