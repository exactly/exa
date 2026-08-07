import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([secret("redis-url"), signer("allower")]).then(([redisUrl, allower]) => worker({ allower, redisUrl })),
);
