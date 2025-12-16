import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketHandler } from "@electric-sql/pglite-socket";
import type * as DrizzleKit from "drizzle-kit/api";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { createServer, type Socket } from "node:net";
import { env } from "node:process";
import { afterAll, beforeAll, vi } from "vitest";

import type * as database from "../../database";
import * as schema from "../../database/schema";

const pglite = new PGlite(undefined, { debug: 0 });

beforeAll(() => {
  if (env.NODE_ENV !== "e2e") return;
  createServer((socket: Socket) => {
    new PGLiteSocketHandler({ db: pglite, closeOnDetach: true }).attach(socket).catch(() => socket.end());
  }).listen(5432, "127.0.0.1");
});

vi.doMock("../../database", async (importOriginal) => {
  const { pushSchema } = require("drizzle-kit/api") as typeof DrizzleKit; // eslint-disable-line @typescript-eslint/no-require-imports, unicorn/prefer-module
  const instance = drizzle(pglite, { schema });
  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  process.stdout.write = () => true;
  const { apply } = await pushSchema(schema, instance as unknown as PgliteDatabase);
  await apply();
  process.stdout.write = stdoutWrite;
  return { ...(await importOriginal<typeof database>()), default: instance };
});

afterAll(() => pglite.close());
