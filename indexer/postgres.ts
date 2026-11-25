import { AuthTypes, Connector, IpAddressTypes } from "@google-cloud/cloud-sql-connector";
import { env } from "node:process";

const connector = new Connector();

export default async function postgres() {
  if (!env.INDEXER_INSTANCE) return;
  if (!env.DATABASE_USER) throw new Error("missing database user");
  return {
    ...(await connector.getOptions({
      authType: AuthTypes.IAM,
      instanceConnectionName: env.INDEXER_INSTANCE,
      ipType: IpAddressTypes.PRIVATE,
    })),
    database: "indexer",
    user: env.DATABASE_USER,
  };
}

export function close() {
  connector.close();
}
