import { name } from "./job";
import worker from "./worker";
import secret from "../../utils/secret";
import bin from "../bin";

bin(
  name,
  Promise.all([secret("account-alchemy-webhooks-key"), secret("redis-url")]).then((secrets) =>
    worker({ alchemyKey: secrets[0], redisUrl: secrets[1] }),
  ),
);
