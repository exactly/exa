import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "../../database/schema";
import supervise, { own } from "../../supervise";
import secret from "../../utils/secret";
import createSponsorHook from "../sponsor";

const secrets = new SecretManagerServiceClient();

supervise(
  "sponsor",
  Promise.all([
    secret("sponsor-postgres-url", secrets).then((url) => drizzle(url, { schema })),
    secret("sponsor-token", secrets),
  ]).then(([database, token]) =>
    own(
      createSponsorHook({ database, token }),
      () => database.$client.end(),
      () => secrets.close(),
    ),
  ),
);
