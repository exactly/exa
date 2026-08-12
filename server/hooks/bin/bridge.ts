import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import createPersona from "../../utils/persona";
import createBridge from "../../utils/ramps/bridge";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import bridge from "../bridge";

const secrets = new SecretManagerServiceClient();

supervise(
  "bridge",
  Promise.all([
    Promise.all([secret("bridge-bridge-api-key", secrets), secret("bridge-api-url", secrets)]).then(([key, url]) =>
      createBridge(key, url),
    ),
    secret("bridge-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("bridge-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    Promise.all([secret("bridge-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    secret("bridge-segment-write-key", secrets).then((key) => createSegment(key)),
  ]).then(([provider, database, onesignal, persona, segment]) =>
    own(
      bridge({ bridge: provider, database, onesignal, persona, segment }),
      () => database.$client.end(),
      () => secrets.close(),
      () => segment.close(),
    ),
  ),
);
