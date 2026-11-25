import { AuthTypes, Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "node:process";
import { Pool } from "pg";

import secret from "./secret";
import * as schema from "../database/schema";

import type { SecretManagerServiceClient } from "@google-cloud/secret-manager";

const connector = new Connector();

export default function postgres(name: string, secrets: SecretManagerServiceClient) {
  return connect(env.DATABASE_INSTANCE, "exa", name, secrets);
}

export function indexer(name: string, secrets: SecretManagerServiceClient) {
  return connect(env.INDEXER_INSTANCE, "indexer", name, secrets);
}

export async function databases(name: string, secrets: SecretManagerServiceClient) {
  const [server, views] = await Promise.all([
    postgres(name, secrets),
    env.INDEXER_INSTANCE ? indexer(name, secrets) : undefined,
  ]);
  return { database: drizzle({ client: server, schema }), views: drizzle({ client: views ?? server, schema }) };
}

export function end(...clients: { $client: Pool }[]) {
  return Promise.all([...new Set(clients.map(({ $client }) => $client))].map((client) => client.end()));
}

async function connect(
  instance: string | undefined,
  database: string,
  name: string,
  secrets: SecretManagerServiceClient,
) {
  if (!instance) return new Pool({ connectionString: await secret(`${name}-postgres-url`, secrets) });
  if (!env.DATABASE_USER) throw new Error("missing database user");
  return new Pool({
    ...(await connector.getOptions({
      authType: AuthTypes.IAM,
      instanceConnectionName: instance,
      ipType: IpAddressTypes.PRIVATE,
    })),
    database,
    max: 5,
    user: env.DATABASE_USER,
  });
}
