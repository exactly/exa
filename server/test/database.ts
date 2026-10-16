import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/node-postgres";
import EmbeddedPostgres from "embedded-postgres";
import { spawn, type ChildProcess } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
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

  try {
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
      await postgres.stop();
    };
  } catch (error) {
    await database.$client.end().catch(() => undefined);
    await postgres.stop().catch(() => undefined);
    throw error;
  }
}
