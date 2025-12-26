import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { $ } from "execa";
import { rm } from "node:fs/promises";
import { env } from "node:process";
import waitOn from "wait-on";

import * as schema from "../database/schema";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import deriveAddress from "@exactly/common/deriveAddress";
import { literal, object, parse, tuple } from "valibot";
import { Address } from "@exactly/common/validation";

const POSTGRES_URL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable";

export default async function setup() {
  const verbose = env.NODE_ENV === "e2e";
  await rm("pg-data", { recursive: true, force: true });
  const pg = new EmbeddedPostgres({
    databaseDir: "pg-data",
    password: "postgres",
    onLog: verbose ? process.stdout.write.bind(process.stdout) : () => null,
  });
  await pg.initialise(); // cspell:ignore initialise
  await pg.start();
  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  const database = drizzle(POSTGRES_URL, { schema });
  if (!verbose) process.stdout.write = () => true;
  await Promise.all([
    rm("firehose-data", { recursive: true, force: true }),
    waitOn({ resources: ["tcp:localhost:8545"] }),
    pushSchema(schema, database as never).then(({ apply }) => apply()),
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
  })`substreams-sink-sql run ${POSTGRES_URL}&schemaName=substreams substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 0`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  /* eslint-enable no-void */

  await waitOn({ resources: ["node_modules/@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json"] });
  const factory = await import("@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json").then(
    (json) =>
      parse(
        object({
          transactions: tuple([
            object({ transactionType: literal("CALL"), function: literal("deploy(bytes32,bytes)") }),
            object({ contractName: literal("ExaAccountFactory"), contractAddress: Address }),
          ]),
        }),
        json,
      ).transactions[1].contractAddress,
  );
  const owner = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });
  await database
    .insert(schema.credentials)
    .values([{ id: account, publicKey: hexToBytes(owner), account, factory, pandaId: "pandaId" }]);
  await database.$client.end();

  return async function teardown() {
    controller.abort();
    await pg.stop();
  };
}
