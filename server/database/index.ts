import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "node:process";

import * as schema from "./schema";

if (!env.POSTGRES_URL) throw new Error("missing postgres url");

const database = drizzle(env.POSTGRES_URL, { schema });

export default database;

export * from "./schema";

export const authAdapter = drizzleAdapter(database, {
  provider: "pg",
  schema: {
    user: schema.users,
    session: schema.sessions,
    account: schema.authenticators,
    verification: schema.verifications,
    walletAddress: schema.walletAddresses,
    organization: schema.organizations,
    member: schema.members,
    invitation: schema.invitations,
  },
});
