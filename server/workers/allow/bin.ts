import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";

supervise(
  name,
  secret("redis-url").then((redisUrl) => worker({ redisUrl })),
);
