import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import postgres from "../../utils/postgres";
import secret from "../../utils/secret";
import createSponsorHook from "../sponsor";

const secrets = new SecretManagerServiceClient();

supervise(
  "sponsor",
  Promise.all([
    postgres("sponsor", secrets).then((client) => drizzle({ client, schema })),
    secret("sponsor-token", secrets),
  ]).then(([database, signingKey]) =>
    own(
      createSponsorHook({ database, signingKey }),
      () => database.$client.end(),
      () => secrets.close(),
    ),
  ),
);
