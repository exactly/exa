import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";

supervise(
  name,
  Promise.all([secret("poke-onesignal-api-key"), secret("redis-url"), secret("poke-segment-write-key")]).then(
    ([onesignalKey, redisUrl, segmentKey]) => worker({ onesignalKey, redisUrl, segmentKey }),
  ),
);
