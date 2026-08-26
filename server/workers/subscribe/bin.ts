import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createAlchemy from "../../utils/alchemy";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("subscribe-alchemy-webhooks-key", secrets).then((key) => createAlchemy(key)),
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("subscribe-postgres-url", secrets).then((url) => drizzle(url, { schema })),
  ]).then(([alchemy, bullmq, database]) =>
    own(
      worker({ alchemy, bullmq, database }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => secrets.close(),
    ),
  ),
);
