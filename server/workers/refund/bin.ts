import { name } from "./job";
import worker from "./worker";
import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";

supervise(
  name,
  Promise.all([secret("refund-panda-api-key"), secret("panda-api-url"), secret("redis-url"), signer("refunder")]).then(
    ([pandaKey, pandaUrl, redisUrl, refunder]) => worker({ pandaKey, pandaUrl, redisUrl, refunder }),
  ),
);
