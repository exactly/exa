import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createOnesignal from "../../utils/onesignal";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("credit-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("credit-onesignal-api-key", secrets).then((key) => createOnesignal(key)),
  ]).then(([bullmq, database, onesignal]) =>
    own(
      worker({ bullmq, database, onesignal }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => secrets.close(),
    ),
  ),
);
