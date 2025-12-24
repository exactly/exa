import { pushSchema } from "drizzle-kit/api";
import EmbeddedPostgres from "embedded-postgres";
import { $ } from "execa";
import { rm } from "node:fs/promises";
import { env } from "node:process";
import waitOn from "wait-on";

import * as schema from "../database/schema";

export default async function setup() {
  const verbose = env.NODE_ENV === "e2e";
  await rm("pg-data", { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: "pg-data",
    password: "postgres",
    onLog: verbose ? console.log : () => null,
  });
  await pg.initialise(); // cspell:ignore initialise
  await pg.start();
  env.POSTGRES_URL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable";
  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  if (!verbose) process.stdout.write = () => true;
  await Promise.all([
    rm("firehose-data", { recursive: true, force: true }),
    waitOn({ resources: ["tcp:localhost:8545"] }),
    import("../database").then(({ default: db }) =>
      pushSchema(schema, db as never)
        .then(({ apply }) => apply())
        .then(() => db.$client.end()),
    ),
  ]);
  if (!verbose) process.stdout.write = stdoutWrite;
  const controller = new AbortController();
  void $({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
  })`fireeth tools poll-rpc-blocks http://localhost:8545 0`.pipe({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
  })`tsx script/firehose.ts`.pipe({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
    stdout: verbose ? "inherit" : "ignore",
    stderr: verbose ? "inherit" : "ignore",
  })`fireeth start reader-node-stdin,merger,relayer,substreams-tier1 --advertise-chain-name=anvil --config-file=`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  await waitOn({ resources: ["tcp:localhost:10016"] });
  void $({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
    stdout: verbose ? "inherit" : "ignore",
    stderr: verbose ? "inherit" : "ignore",
    cwd: "node_modules/@exactly/substreams",
    env: { SUBSTREAMS_ENDPOINTS_CONFIG_ANVIL: "localhost:10016" }, // cspell:ignore sslmode
  })`substreams-sink-sql run ${env.POSTGRES_URL}&schemaName=substreams substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 0`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  /* eslint-enable no-void */

  return async function teardown() {
    controller.abort();
    await pg.stop();
  };
}
