import supervise from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import panda from "../panda";

supervise(
  "panda",
  Promise.all([
    signer("issuer"),
    secret("panda-onesignal-api-key"),
    secret("panda-panda-api-key"),
    secret("panda-api-url"),
    secret("panda-postgres-url"),
    secret("redis-url"),
    secret("panda-sardine-api-key"),
    secret("sardine-api-url"),
    secret("panda-segment-write-key"),
    signer("settler"),
  ]).then(
    ([issuer, onesignalKey, pandaKey, pandaUrl, postgresUrl, redisUrl, sardineKey, sardineUrl, segmentKey, settler]) =>
      panda({
        issuer,
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
