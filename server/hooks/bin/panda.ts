import supervise from "../../supervise";
import secret from "../../utils/secret";
import { getAccount } from "../../utils/wallet";
import panda from "../panda";

supervise(
  "panda",
  Promise.all([
    secret("panda-issuer-private-key"),
    secret("panda-onesignal-api-key"),
    secret("panda-panda-api-key"),
    secret("panda-api-url"),
    secret("panda-postgres-url"),
    secret("redis-url"),
    secret("panda-sardine-api-key"),
    secret("sardine-api-url"),
    secret("panda-segment-write-key"),
    getAccount("settler"),
  ]).then(
    ([
      issuerKey,
      onesignalKey,
      pandaKey,
      pandaUrl,
      postgresUrl,
      redisUrl,
      sardineKey,
      sardineUrl,
      segmentKey,
      settler,
    ]) =>
      panda({
        issuerKey,
        onesignalKey,
        pandaKey,
        pandaUrl,
        postgresUrl,
        redisUrl,
        sardineKey,
        sardineUrl,
        segmentKey,
        settler,
      }),
  ),
);
