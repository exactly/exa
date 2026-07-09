import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import createPanda from "../../utils/panda";
import createSardine from "../../utils/sardine";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import { signer } from "../../utils/wallet";
import { connect } from "../worker";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("refund-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("refund-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    Promise.all([secret("refund-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
    signer("refunder", kms),
    Promise.all([secret("refund-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
    secret("refund-segment-write-key", secrets).then((key) => createSegment(key)),
  ]).then(([bullmq, database, onesignal, panda, refunder, sardine, segment]) =>
    own(
      worker({ bullmq, database, onesignal, panda, refunder, sardine, segment }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => kms.close(),
      () => secrets.close(),
      () => segment.close(),
    ),
  ),
);
