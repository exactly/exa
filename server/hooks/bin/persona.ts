import supervise from "../../supervise";
import secret from "../../utils/secret";
import persona from "../persona";

supervise(
  "persona",
  Promise.all([
    secret("persona-panda-api-key"),
    secret("panda-api-url"),
    secret("persona-pax-associate-id-key"),
    secret("persona-pax-api-key"),
    secret("pax-api-url"),
    secret("persona-persona-api-key"),
    secret("persona-api-url"),
    secret("persona-persona-webhook-secret"),
    secret("persona-postgres-url"),
    secret("redis-url"),
    secret("persona-sardine-api-key"),
    secret("sardine-api-url"),
  ]).then(
    ([
      pandaKey,
      pandaUrl,
      paxAssociateKey,
      paxKey,
      paxUrl,
      personaKey,
      personaUrl,
      personaWebhookSecret,
      postgresUrl,
      redisUrl,
      sardineKey,
      sardineUrl,
    ]) =>
      persona({
        pandaKey,
        pandaUrl,
        paxAssociateKey,
        paxKey,
        paxUrl,
        personaKey,
        personaUrl,
        personaWebhookSecret,
        postgresUrl,
        redisUrl,
        sardineKey,
        sardineUrl,
      }),
  ),
);
