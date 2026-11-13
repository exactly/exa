import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import createMockfiHook from "../mockfi";

const secrets = new SecretManagerServiceClient();

supervise(
  "mockfi",
  secret("mockfi-postgres-url", secrets)
    .then((url) => drizzle(url, { schema }))
    .then((database) =>
      own(
        createMockfiHook({ database }),
        () => database.$client.end(),
        () => secrets.close(),
      ),
    ),
);
