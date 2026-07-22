import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([signer("allower"), secret("redis-url")]).then(([allower, redisUrl]) => worker({ allower, redisUrl })),
);
