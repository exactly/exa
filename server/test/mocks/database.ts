import { PGlite } from "@electric-sql/pglite";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type * as DrizzleKit from "drizzle-kit/api";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { vi } from "vitest";

import type * as database from "../../database";
import * as schema from "../../database/schema";

vi.mock("../../database", async (importOriginal) => {
  const { pushSchema } = require("drizzle-kit/api") as typeof DrizzleKit; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
  const instance = drizzle(new PGlite(undefined, { debug: 0 }), { schema });
  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  process.stdout.write = () => true;
  const { apply } = await pushSchema(schema, instance as unknown as PgliteDatabase);
  await apply();
  process.stdout.write = stdoutWrite;
  const authAdapter = drizzleAdapter(instance, { provider: "sqlite", usePlural: true });
  return { ...(await importOriginal<typeof database>()), default: instance, authAdapter };
});
