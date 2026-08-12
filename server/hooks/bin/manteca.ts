import supervise from "../../supervise";
import secret from "../../utils/secret";
import manteca from "../manteca";

supervise(
  "manteca",
  Promise.all([
    secret("manteca-manteca-api-key"),
    secret("manteca-api-url"),
    secret("manteca-webhooks-key"),
    secret("manteca-onesignal-api-key"),
    secret("manteca-postgres-url"),
    secret("manteca-segment-write-key"),
  ]).then(([mantecaKey, mantecaUrl, mantecaWebhookKey, onesignalKey, postgresUrl, segmentKey]) =>
    manteca({ mantecaKey, mantecaUrl, mantecaWebhookKey, onesignalKey, postgresUrl, segmentKey }),
  ),
);
