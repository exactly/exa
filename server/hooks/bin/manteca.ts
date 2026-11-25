import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import { publisher } from "../../utils/events";
import createOnesignal from "../../utils/onesignal";
import postgres from "../../utils/postgres";
import createManteca from "../../utils/ramps/manteca";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import manteca from "../manteca";

const secrets = new SecretManagerServiceClient();

supervise(
  "manteca",
  Promise.all([
    postgres("manteca", secrets).then((client) => publisher(drizzle({ client, schema }))),
    Promise.all([secret("manteca-manteca-api-key", secrets), secret("manteca-api-url", secrets)]).then(([key, url]) =>
      createManteca(key, url),
    ),
    secret("manteca-webhooks-key", secrets),
    secret("manteca-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    secret("manteca-segment-write-key", secrets).then((key) => createSegment(key)),
  ]).then(([database, provider, mantecaWebhookKey, onesignal, segment]) =>
    own(
      manteca({ database, manteca: provider, mantecaWebhookKey, onesignal, segment }),
      () => database.$client.end(),
      () => secrets.close(),
      () => segment.close(),
    ),
  ),
);
