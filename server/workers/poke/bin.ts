import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([
    secret("poke-onesignal-api-key"),
    signer("poker"),
    secret("redis-url"),
    secret("poke-segment-write-key"),
  ]).then(([onesignalKey, poker, redisUrl, segmentKey]) => worker({ onesignalKey, poker, redisUrl, segmentKey })),
);
