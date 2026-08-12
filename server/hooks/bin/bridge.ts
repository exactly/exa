import supervise from "../../supervise";
import secret from "../../utils/secret";
import bridge from "../bridge";

supervise(
  "bridge",
  Promise.all([
    secret("bridge-bridge-api-key"),
    secret("bridge-api-url"),
    secret("bridge-onesignal-api-key"),
    secret("bridge-persona-api-key"),
    secret("persona-api-url"),
    secret("bridge-postgres-url"),
    secret("bridge-segment-write-key"),
  ]).then(([bridgeKey, bridgeUrl, onesignalKey, personaKey, personaUrl, postgresUrl, segmentKey]) =>
    bridge({ bridgeKey, bridgeUrl, onesignalKey, personaKey, personaUrl, postgresUrl, segmentKey }),
  ),
);
