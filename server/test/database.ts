import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { $, type ResultPromise } from "execa";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { literal, object, parse, tuple } from "valibot";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import waitOn from "wait-on";

import deriveAddress from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";

import * as schema from "../database/schema";

export default async function setup() {
  const databaseDir = "node_modules/@exactly/.postgres"; // eslint-disable-line unicorn/prevent-abbreviations
  await rm(databaseDir, { recursive: true, force: true });
  const postgres = new EmbeddedPostgres({ databaseDir, port: 8432, password: "postgres", onLog: () => null });
  await postgres.initialise(); // cspell:ignore initialise
  await postgres.start();
  const postgresProcess = (postgres as unknown as { process: ChildProcess }).process;
  const postgresExited = new Promise<never>((_, reject) => {
    postgresProcess.once("error", reject);
    postgresProcess.once("exit", (code, signal) => {
      reject(new Error(`embedded postgres exited before readiness (code: ${String(code)}, signal: ${String(signal)})`));
    });
  });
  spawn(
    "node",
    [
      "-e",
      `
  process.stdin.resume();
  process.stdin.on("end", () => {
    try { process.kill(${postgresProcess.pid}, "SIGINT"); } catch {}
    process.exit();
  });
  `,
    ],
    { detached: true, stdio: ["pipe", "ignore", "ignore"] },
  ).unref();

  const postgresURL = "postgres://postgres:postgres@localhost:8432/postgres?sslmode=disable"; // cspell:ignore sslmode
  const startupLogs = "node_modules/@exactly/.runtime/startup";
  const database = await (async () => {
    await Promise.race([waitOn({ resources: ["tcp:localhost:8432"], timeout: 120_000 }), postgresExited]);
    const stdoutWrite = process.stdout.write; // eslint-disable-line @typescript-eslint/unbound-method
    const db = drizzle(postgresURL, { schema });
    try {
      process.stdout.write = () => true;
      await Promise.all([
        pushSchema(schema, db as never).then(({ apply }) => apply()),
        Promise.race([waitOn({ resources: ["tcp:localhost:8545"], timeout: 120_000 }), postgresExited]),
        rm("node_modules/@exactly/.firehose", { recursive: true, force: true }),
      ]);
      await rm(startupLogs, { recursive: true, force: true });
      await mkdir(startupLogs, { recursive: true });
      return db;
    } catch (error) {
      await db.$client.end().catch(() => undefined);
      throw error;
    } finally {
      process.stdout.write = stdoutWrite;
    }
  })().catch(async (error: unknown) => {
    await postgres.stop().catch(() => undefined);
    throw error;
  });

  const controller = new AbortController();
  let firehoseExited: Promise<void> = Promise.resolve();
  let firehoseOutputFlushed: Promise<void> = Promise.resolve();
  let substreamsExited: Promise<void> = Promise.resolve();
  let substreamsOutputFlushed: Promise<void> = Promise.resolve();
  try {
    const firehoseLog = `${startupLogs}/firehose.log`;
    const firehoseOutput = createWriteStream(firehoseLog);
    const firehose = $({
      cancelSignal: controller.signal,
      forceKillAfterDelay: 33_333,
      env: { ETH_RPC_SHORT_BLOCK_NUMBER_NOTATION: "true" },
    })`fireeth start reader-node,merger,relayer,substreams-tier1 --advertise-chain-name=anvil --config-file= --data-dir=node_modules/@exactly/.firehose --reader-node-path=bash --reader-node-arguments=${'-c "\
      fireeth tools poll-rpc-blocks http://localhost:8545 0 | tsx script/firehose.ts"'}`;
    const firehoseLogWatcher = watchProcessOutput(firehose, firehoseOutput, controller);
    firehoseExited = firehoseLogWatcher.exit;
    firehoseOutputFlushed = firehoseLogWatcher.outputFlushed;
    try {
      await Promise.race([
        waitOn({ resources: ["tcp:localhost:10016"], timeout: 120_000 }),
        postgresExited.then(() => {
          throw new Error("postgres exited waiting fireeth");
        }),
        firehoseExited.then(() => {
          throw new Error("fireeth exited before tcp:10016");
        }),
        firehoseLogWatcher.outputError,
      ]);
    } catch (error) {
      controller.abort();
      await firehoseExited.catch(() => undefined);
      await firehoseOutputFlushed;
      const message = error instanceof Error ? error.message : String(error);
      const firehoseText = await readFile(firehoseLog, "utf8").catch(() => "");
      throw new Error(`wait tcp:10016: ${message}\nfirehose:\n${firehoseText}`, { cause: error });
    } finally {
      firehoseLogWatcher.stopWatchingOutput();
    }

    const substreamsLog = `${startupLogs}/substreams.log`;
    const substreamsOutput = createWriteStream(substreamsLog);
    const substreams = $({
      cancelSignal: controller.signal,
      forceKillAfterDelay: 33_333,
      cwd: "node_modules/@exactly/substreams",
      env: { SUBSTREAMS_ENDPOINTS_CONFIG_ANVIL: "localhost:10016" },
    })`substreams-sink-sql run ${postgresURL}&schemaName=substreams substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 0`;
    const substreamsLogWatcher = watchProcessOutput(substreams, substreamsOutput, controller);
    substreamsExited = substreamsLogWatcher.exit;
    substreamsOutputFlushed = substreamsLogWatcher.outputFlushed;

    const factoryBroadcast = "node_modules/@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json";
    try {
      await Promise.race([
        waitOn({ resources: [factoryBroadcast], timeout: 120_000 }),
        postgresExited.then(() => {
          throw new Error("postgres exited waiting substreams");
        }),
        firehoseExited.then(() => {
          throw new Error("fireeth exited waiting substreams");
        }),
        substreamsExited.then(() => {
          throw new Error(`substreams exited before ${factoryBroadcast}`);
        }),
        substreamsLogWatcher.outputError,
      ]);
    } catch (error) {
      controller.abort();
      await substreamsExited.catch(() => undefined);
      await substreamsOutputFlushed;
      const message = error instanceof Error ? error.message : String(error);
      const firehoseText = await readFile(firehoseLog, "utf8").catch(() => "");
      const substreamsText = await readFile(substreamsLog, "utf8").catch(() => "");
      throw new Error(`wait on ${factoryBroadcast}: ${message}\nfh:${firehoseText}\nss:${substreamsText}`, {
        cause: error,
      });
    } finally {
      substreamsLogWatcher.stopWatchingOutput();
    }

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
      await Promise.allSettled([
        postgres.stop(),
        firehoseExited,
        substreamsExited,
        firehoseOutputFlushed,
        substreamsOutputFlushed,
      ]);
    };
  } catch (error) {
    controller.abort();
    await database.$client.end().catch(() => undefined);
    await Promise.allSettled([
      postgres.stop(),
      firehoseExited,
      substreamsExited,
      firehoseOutputFlushed,
      substreamsOutputFlushed,
    ]);
    throw error;
  }
}

function watchProcessOutput(subprocess: ResultPromise, output: WriteStream, controller: AbortController) {
  const outputFlushed = new Promise<void>((resolve) => {
    output.once("close", resolve);
  });
  output.on("error", () => undefined);
  subprocess.stdout?.on("data", (chunk: string | Uint8Array) => output.write(chunk));
  subprocess.stderr?.on("data", (chunk: string | Uint8Array) => output.write(chunk));
  const exit = subprocess
    .finally(() => output.end())
    .then(
      () => undefined,
      (error: unknown) => {
        if (controller.signal.aborted) return;
        throw error;
      },
    );
  let onOutputError: ((error: unknown) => void) | undefined;
  const outputError = new Promise<never>((_, reject) => {
    onOutputError = (error: unknown) => reject(error instanceof Error ? error : new Error(String(error)));
  });
  outputError.catch(() => undefined);
  if (!onOutputError) throw new Error("missing output error handler");
  output.on("error", onOutputError);
  return {
    exit,
    outputFlushed,
    outputError,
    stopWatchingOutput: () => {
      if (!onOutputError) return;
      output.off("error", onOutputError);
    },
  };
}
