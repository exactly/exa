import { drizzle } from "drizzle-orm/node-postgres";
import { env } from "node:process";

import * as schema from "./schema";

if (!env.POSTGRES_URL) throw new Error("missing postgres url");

export default drizzle(env.POSTGRES_URL, { schema });

export * from "./schema";
