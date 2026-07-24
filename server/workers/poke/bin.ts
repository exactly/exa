import { name } from "./job";
import worker from "./worker";
import secret from "../../utils/secret";
import bin from "../bin";

bin(
  name,
  Promise.all([secret("poke-onesignal-api-key"), secret("redis-url"), secret("poke-segment-write-key")]).then(
    (secrets) => worker({ onesignalKey: secrets[0], redisUrl: secrets[1], segmentKey: secrets[2] }),
  ),
);
