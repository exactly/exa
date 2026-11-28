import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import createPanda from "../../utils/panda";
import postgres from "../../utils/postgres";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    postgres("hook", secrets).then((client) => drizzle({ client, schema })),
    Promise.all([
      secret("hook-panda-api-key", secrets),
      secret("panda-api-url", secrets),
      secret("hook-panda-base-api-key", secrets),
      secret("panda-base-api-url", secrets),
    ]).then(([key, url, baseKey, baseUrl]) => createPanda({ key, url }, { key: baseKey, url: baseUrl })),
  ]).then(([bullmq, database, panda]) =>
    own(
      worker({ bullmq, database, panda }),
      () => bullmq.quit(),
      () => database.$client.end(),
      () => secrets.close(),
    ),
  ),
);
