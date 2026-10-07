import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { $, type ResultPromise } from "execa";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { literal, number, object, parse, record, string, tuple } from "valibot";
import { hexToBytes, padHex, zeroHash } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import waitOn from "wait-on";

import deriveAddress from "@exactly/common/deriveAddress";
import { Address } from "@exactly/common/validation";

import anvilClient from "./anvilClient";
import * as schema from "../database/schema";

export default async function setup() {
  const databaseDir = "node_modules/@exactly/.postgres"; // eslint-disable-line unicorn/prevent-abbreviations
  await rm(databaseDir, { recursive: true, force: true });
  const postgres = new EmbeddedPostgres({
    databaseDir,
    port: 8432,
    password: "postgres",
    createPostgresUser: process.getuid?.() === 0,
    onLog: () => null,
  });
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
  let indexerExited: Promise<void> = Promise.resolve();
  let indexerOutputFlushed: Promise<void> = Promise.resolve();
  try {
    const head = Number(await anvilClient.getBlockNumber());
    const indexerLog = `${startupLogs}/indexer.log`;
    const indexerOutput = createWriteStream(indexerLog);
    const indexer = $({
      cancelSignal: controller.signal,
      forceKillAfterDelay: 33_333,
      cwd: "node_modules/@exactly/indexer",
      env: { POSTGRES_URL: postgresURL, PORT: "42069" },
      preferLocal: true,
    })`ponder start --schema test --views-schema indexer`;
    const indexerLogWatcher = watchProcessOutput(indexer, indexerOutput, controller);
    indexerExited = indexerLogWatcher.exit;
    indexerOutputFlushed = indexerLogWatcher.outputFlushed;
    try {
      await Promise.race([
        waitOn({ resources: ["http-get://localhost:42069/ready"], timeout: 120_000 }).then(async () => {
          const signal = AbortSignal.timeout(120_000);
          while (
            Object.values(
              parse(
                record(string(), object({ block: object({ number: number() }) })),
                await fetch("http://localhost:42069/status", { signal }).then((response) => response.json()),
              ),
            ).every(({ block }) => block.number < head)
          ) {
            await setTimeout(100, undefined, { signal });
          }
        }),
        postgresExited.then(() => {
          throw new Error("postgres exited waiting indexer");
        }),
        indexerExited.then(() => {
          throw new Error(`indexer exited before block ${head}`);
        }),
        indexerLogWatcher.outputError,
      ]);
    } catch (error) {
      controller.abort();
      await indexerExited.catch(() => undefined);
      await indexerOutputFlushed;
      const message = error instanceof Error ? error.message : String(error);
      const indexerText = await readFile(indexerLog, "utf8").catch(() => "");
      throw new Error(`wait indexer: ${message}\nindexer:\n${indexerText}`, { cause: error });
    } finally {
      indexerLogWatcher.stopWatchingOutput();
    }

    const factory = parse(
      object({
        transactions: tuple([
          object({ transactionType: literal("CALL"), function: literal("deploy(bytes32,bytes)") }),
          object({ contractName: literal("ExaAccountFactory"), contractAddress: Address }),
        ]),
      }),
      JSON.parse(
        await readFile("node_modules/@exactly/plugin/broadcast/ExaAccountFactory.s.sol/31337/run-latest.json", "utf8"),
      ),
    ).transactions[1].contractAddress;
    const owner = privateKeyToAddress(padHex("0xb0b"));
    const account = deriveAddress(factory, { x: padHex(owner), y: zeroHash });
    await database
      .insert(schema.credentials)
      .values([{ id: "bob", publicKey: new Uint8Array(hexToBytes(owner)), account, factory, pandaId: "pandaId" }]);
    await database.$client.end();

    return async function teardown() {
      controller.abort();
      await Promise.allSettled([postgres.stop(), indexerExited, indexerOutputFlushed]);
    };
  } catch (error) {
    controller.abort();
    await database.$client.end().catch(() => undefined);
    await Promise.allSettled([postgres.stop(), indexerExited, indexerOutputFlushed]);
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
