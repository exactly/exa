import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";

supervise(
  name,
  Promise.all([secret("refund-panda-api-key"), secret("panda-api-url"), secret("redis-url")]).then(
    ([pandaKey, pandaUrl, redisUrl]) => worker({ pandaKey, pandaUrl, redisUrl }),
  ),
);
