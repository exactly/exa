import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import createPanda from "../../utils/panda";
import createPersona from "../../utils/persona";
import createSardine from "../../utils/sardine";
import secret from "../../utils/secret";
import createSegment from "../../utils/segment";
import { signer } from "../../utils/wallet";
import createCredit from "../../workers/credit/queue";
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
    Promise.all([secret("panda-persona-api-key", secrets), secret("persona-api-url", secrets)]).then(([key, url]) =>
      createPersona(key, url),
    ),
    secret("redis-url", secrets)
      .then((url) => connect(url))
      .then((bullmq) => [bullmq, createCredit(bullmq), createRefund(bullmq), createHook(bullmq)] as const),
    Promise.all([secret("panda-sardine-api-key", secrets), secret("sardine-api-url", secrets)]).then(([key, url]) =>
      createSardine(key, url),
    ),
    secret("panda-segment-write-key", secrets).then((key) => createSegment(key)),
    signer("settler", kms),
  ]).then(
    ([database, issuer, onesignal, provider, persona, [bullmq, credit, refund, webhook], sardine, segment, settler]) =>
      own(
        panda({
          credit,
          database,
          issuer,
          onesignal,
          panda: provider,
          persona,
          refund,
          sardine,
          segment,
          settler,
          webhook,
        }),
        () => database.$client.end(),
        () => kms.close(),
        () => secrets.close(),
        () => segment.close(),
        () => Promise.all([credit.close(), refund.close(), webhook.close()]).finally(() => bullmq.quit()),
      ),
  ),
);
