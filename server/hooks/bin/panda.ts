import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import createPanda from "../../utils/panda";
import createSardine from "../../utils/sardine";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import { signer } from "../../utils/wallet";
import createHook from "../../workers/hook/queue";
import createRefund from "../../workers/refund/queue";
import { connect } from "../../workers/worker";
import panda from "../panda";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  "panda",
  Promise.all([
    secret("panda-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    signer("issuer", kms),
    secret("panda-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
    Promise.all([secret("panda-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
    secret("redis-url", secrets)
      .then((url) => connect(url))
      .then((bullmq) => [bullmq, createRefund(bullmq), createHook(bullmq)] as const),
    Promise.all([secret("panda-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
    secret("panda-segment-write-key", secrets).then((key) => createSegment(key)),
    signer("settler", kms),
  ]).then(([database, issuer, onesignal, provider, [bullmq, refund, webhook], sardine, segment, settler]) =>
    own(
      panda({ database, issuer, onesignal, panda: provider, refund, sardine, segment, settler, webhook }),
      () => database.$client.end(),
      () => kms.close(),
      () => secrets.close(),
      () => segment.close(),
      () => Promise.all([refund.close(), webhook.close()]).finally(() => bullmq.quit()),
    ),
  ),
);
