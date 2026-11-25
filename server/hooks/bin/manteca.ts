import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";
import { Redis } from "ioredis";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import { publisher } from "../../utils/events";
import createOnesignal from "../../utils/onesignal";
import createManteca from "../../utils/ramps/manteca";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import { signer } from "../../utils/wallet";
import createQR from "../../workers/qr/queue";
import manteca from "../manteca";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  "manteca",
  Promise.all([
    secret("manteca-postgres-url", secrets).then((url) => publisher(drizzle(url, { schema }))),
    Promise.all([secret("manteca-manteca-api-key", secrets), secret("manteca-api-url", secrets)]).then(([key, url]) =>
      createManteca(key, url),
    ),
    signer("issuer", kms),
    secret("manteca-webhooks-key", secrets),
    secret("manteca-onesignal-api-keys", secrets).then((key) => createOnesignal(key)),
    secret("redis-url", secrets).then((url) => new Redis(url)),
    signer("refunder", kms),
    secret("manteca-segment-write-key", secrets).then((key) => createSegment(key)),
  ]).then(([database, provider, issuer, mantecaWebhookKey, onesignal, redis, refunder, segment]) => {
    const qr = createQR(redis);
    return own(
      manteca({ database, issuer, manteca: provider, mantecaWebhookKey, onesignal, qr, redis, refunder, segment }),
      () => database.$client.end(),
      () => kms.close(),
      () => qr.close().finally(() => redis.quit()),
      () => secrets.close(),
      () => segment.close(),
    );
  }),
);
