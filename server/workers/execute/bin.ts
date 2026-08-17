import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([signer("executor"), secret("execute-onesignal-api-key"), secret("redis-url")]).then(
    ([executor, onesignalKey, redisUrl]) => worker({ executor, onesignalKey, redisUrl }),
  ),
);
