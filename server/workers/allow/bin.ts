import { name } from "./job";
import worker from "./worker";
import secret from "../../utils/secret";
import bin from "../bin";

bin(
  name,
  secret("redis-url").then((redisUrl) => worker({ redisUrl })),
);
