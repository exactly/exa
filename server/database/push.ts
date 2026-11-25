import { SecretManagerServiceClient } from "@google-cloud/secret-manager";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema";
import supervise, { own } from "../supervise";
import postgres from "../utils/postgres";

const secrets = new SecretManagerServiceClient();

supervise(
  "push",
  postgres("push", secrets).then((client) =>
    own(
      {
        check: true,
        ready: pushSchema(schema, drizzle({ client })).then(({ apply, hasDataLoss, warnings }) => {
          if (hasDataLoss || warnings.length > 0) throw new Error(warnings.join("\n") || "data loss");
          return apply();
        }),
      },
      () => client.end(),
      () => secrets.close(),
    ),
  ),
);
