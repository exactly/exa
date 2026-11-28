import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import { indexer } from "../../utils/postgres";
import createMockfiHook from "../mockfi";

const secrets = new SecretManagerServiceClient();

supervise(
  "mockfi",
  indexer("mockfi", secrets)
    .then((client) => drizzle({ client, schema }))
    .then((database) =>
      own(
        createMockfiHook({ database }),
        () => database.$client.end(),
        () => secrets.close(),
      ),
    ),
);
