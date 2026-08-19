import { defineConfig } from "drizzle-kit";
import { env } from "node:process";

if (!env.POSTGRES_URL) throw new Error("missing postgres url");

export default defineConfig({
  schema: "database/schema.ts",
  dialect: "postgresql",
  schemaFilter: ["public", "substreams"],
  dbCredentials: { url: env.POSTGRES_URL },
  verbose: true,
  strict: true,
});
