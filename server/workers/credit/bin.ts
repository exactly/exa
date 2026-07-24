import { name } from "./job";
import worker from "./worker";
import secret from "../../utils/secret";
import bin from "../bin";

bin(
  name,
  Promise.all([secret("credit-onesignal-api-key"), secret("credit-postgres-url"), secret("redis-url")]).then(
    (secrets) => worker({ onesignalKey: secrets[0], postgresUrl: secrets[1], redisUrl: secrets[2] }),
  ),
);
