import { name } from "./job";
import worker from "./worker";
import secret from "../../utils/secret";
import bin from "../bin";

bin(
  name,
  Promise.all([secret("refund-panda-api-key"), secret("panda-api-url"), secret("redis-url")]).then((secrets) =>
    worker({ pandaKey: secrets[0], pandaUrl: secrets[1], redisUrl: secrets[2] }),
  ),
);
