import { serve } from "@hono/node-server";
import { drizzle } from "drizzle-orm/node-postgres";
import { Hono } from "hono";
import { once } from "node:events";
import { env } from "node:process";

import { lifiURL } from "@exactly/common/generated/chain";

import * as schema from "../database/schema";
import mockfi from "../hooks/mockfi";

export default async function setup() {
  if (env.NODE_ENV === "e2e") return;
  const url = new URL(lifiURL);
  const database = drizzle("postgres://postgres:postgres@localhost:8432/postgres?sslmode=disable", { schema }); // cspell:ignore sslmode
  const server = serve({
    fetch: new Hono().route(url.pathname.replace(/\/v1$/, ""), mockfi({ database }).app).fetch,
    port: Number(url.port),
  });
  await once(server, "listening");

  return async function teardown() {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    await database.$client.end();
  };
}
