import { KeyManagementServiceClient } from "@google-cloud/kms";
import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import { signer } from "../../utils/wallet";
import { connect } from "../worker";

const kms = new KeyManagementServiceClient();
const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("allow-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    signer("allower", kms),
  ]).then(([bullmq, database, allower]) =>
    own(
      worker({ allower, bullmq, database }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => kms.close(),
      () => secrets.close(),
    ),
  ),
);
