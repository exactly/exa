import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([
    signer("issuer"),
    secret("refund-panda-api-key"),
    secret("panda-api-url"),
    secret("redis-url"),
    signer("refunder"),
  ]).then(([issuer, pandaKey, pandaUrl, redisUrl, refunder]) =>
    worker({ issuer, pandaKey, pandaUrl, redisUrl, refunder }),
  ),
);
