import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import { name } from "./job";
import worker from "./worker";
import * as schema from "../../database/schema";
import supervise from "../../supervise";
import createPanda from "../../utils/panda";
import secret from "../../utils/secret";
import { connect } from "../worker";

const secrets = new SecretManagerServiceClient();

supervise(
  name,
  Promise.all([
    secret("redis-url", secrets).then((url) => connect(url)),
    secret("hook-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    Promise.all([secret("hook-panda-api-key", secrets), secret("panda-api-url", secrets)]).then(([key, url]) =>
      createPanda({ key, url }),
    ),
  ]).then(([bullmq, database, panda]) =>
    worker({
      bullmq,
      database,
      panda,
      close: () => Promise.all([bullmq.quit(), database.$client.end(), secrets.close()]),
    }),
  ),
);
