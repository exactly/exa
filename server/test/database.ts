import deriveAddress from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { $ } from "execa";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { literal, object, parse, tuple } from "valibot";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import waitOn from "wait-on";

import * as schema from "../database/schema";

export default async function setup() {
  const databaseDir = "node_modules/@exactly/.postgres"; // eslint-disable-line unicorn/prevent-abbreviations
  await rm(databaseDir, { recursive: true, force: true });
  const postgres = new EmbeddedPostgres({ databaseDir, password: "postgres", onLog: () => null });
  await postgres.initialise(); // cspell:ignore initialise
  await postgres.start();
  spawn(
    "node",
    [
      "-e",
      `
  process.stdin.resume();
  process.stdin.on("end", () => {
    try { process.kill(${(postgres as unknown as { process: ChildProcess }).process.pid}, "SIGINT"); } catch {}
    process.exit();
  });
  `,
    ],
    { detached: true, stdio: ["pipe", "ignore", "ignore"] },
  ).unref();

  await waitOn({ resources: ["tcp:localhost:5432"], timeout: 33_333 });
  const postgresURL = "postgres://postgres:postgres@localhost:5432/postgres?sslmode=disable"; // cspell:ignore sslmode
  const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
  const database = drizzle(postgresURL, { schema });
  process.stdout.write = () => true;
  await Promise.all([
    pushSchema(schema, database as never).then(({ apply }) => apply()),
    waitOn({ resources: ["tcp:localhost:8545"], timeout: 33_333 }),
    rm("node_modules/@exactly/.firehose", { recursive: true, force: true }),
  ]);
  process.stdout.write = stdoutWrite;

  const controller = new AbortController();
  /* eslint-disable no-void */
  void $({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
  })`fireeth start reader-node,merger,relayer,substreams-tier1 --advertise-chain-name=anvil --config-file= \
      --data-dir=node_modules/@exactly/.firehose --reader-node-path=bash --reader-node-arguments=${'-c "\
        fireeth tools poll-rpc-blocks http://localhost:8545 0 | tsx script/firehose.ts"'}`.catch((error: unknown) => {
    if (controller.signal.aborted) return;
    throw error;
  });
  await waitOn({ resources: ["tcp:localhost:10016"], timeout: 33_333 });
  void $({
    cancelSignal: controller.signal,
    forceKillAfterDelay: 33_333,
    cwd: "node_modules/@exactly/substreams",
    env: { SUBSTREAMS_ENDPOINTS_CONFIG_ANVIL: "localhost:10016" },
  })`substreams-sink-sql run ${postgresURL}&schemaName=substreams substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 0`.catch(
    (error: unknown) => {
      if (controller.signal.aborted) return;
      throw error;
    },
  );
  /* eslint-enable no-void */

  const factoryBroadcast = "node_modules/@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json";
  await waitOn({ resources: [factoryBroadcast], timeout: 33_333 });
  const factory = parse(
    object({
      transactions: tuple([
        object({ transactionType: literal("CALL"), function: literal("deploy(bytes32,bytes)") }),
        object({ contractName: literal("ExaAccountFactory"), contractAddress: Address }),
      ]),
    }),
    JSON.parse(await readFile(factoryBroadcast, "utf8")),
  ).transactions[1].contractAddress;
  const owner = privateKeyToAddress(padHex("0xb0b"));
  const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });
  await database
    .insert(schema.credentials)
    .values([{ id: "bob", publicKey: new Uint8Array(hexToBytes(owner)), account, factory, pandaId: "pandaId" }]);
  await database.$client.end();

  return async function teardown() {
    controller.abort();
    await postgres.stop();
  };
}
