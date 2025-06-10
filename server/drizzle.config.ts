import { defineConfig } from "drizzle-kit";

if (!process.env.POSTGRES_URL) throw new Error("missing postgres url");

export default defineConfig({
  schema: "database/schema.ts",
  dialect: "postgresql",
  schemaFilter: ["public", "substreams"],
  dbCredentials: { url: process.env.POSTGRES_URL },
  verbose: true,
  strict: true,
});
