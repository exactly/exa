import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { $ } from "execa";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { env } from "node:process";
import { locks } from "node:worker_threads";
import { fromNodeSocket } from "pg-gateway/node";
import waitOn from "wait-on";

import * as schema from "../database/schema";

export default async function setup() {
  /* eslint-disable no-void */
  const pglite = new PGlite();
  const gateway = createServer((socket) => {
    void fromNodeSocket(socket, {
      onStartup: () => pglite.waitReady,
      onMessage: (message) => locks.request("pglite", () => pglite.execProtocol(message).then(({ data }) => data)),
    });
  });
  gateway.listen(5432);

  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  if (env.NODE_ENV !== "e2e") process.stdout.write = () => true;
  await Promise.all([
    rm("firehose-data", { recursive: true, force: true }),
    waitOn({ resources: ["tcp:localhost:8545"] }),
    pushSchema(schema, drizzle(pglite, { schema }) as never).then(({ apply }) => apply()),
  ]);
  if (env.NODE_ENV !== "e2e") process.stdout.write = stdoutWrite;

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
    stdout: env.NODE_ENV === "e2e" ? "inherit" : "ignore",
    stderr: env.NODE_ENV === "e2e" ? "inherit" : "ignore",
  })`fireeth start reader-node-stdin,merger,relayer,substreams-tier1 --advertise-chain-name=anvil --config-file=`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  await waitOn({ resources: ["tcp:localhost:5432", "tcp:localhost:10016"] });
  void $({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
    stdout: env.NODE_ENV === "e2e" ? "inherit" : "ignore",
    stderr: env.NODE_ENV === "e2e" ? "inherit" : "ignore",
    cwd: "node_modules/@exactly/substreams",
    env: { SUBSTREAMS_ENDPOINTS_CONFIG_ANVIL: "localhost:10016" }, // cspell:ignore sslmode
  })`substreams-sink-sql run postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable&schemaName=substreams substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 0`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  /* eslint-enable no-void */

  return function teardown() {
    controller.abort();
    gateway.close();
  };
}
