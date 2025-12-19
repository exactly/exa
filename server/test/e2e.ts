/// <reference types="vite/client" />
import "./mocks/sentry";
import "./mocks/database";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/redis";

import { $ } from "execa";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

describe("e2e", () => {
  it(
    "runs server",
    /* eslint-disable no-void */
    async () => {
      await rm("firehose-data", { recursive: true, force: true });
      const controller = new AbortController();
      void $({
        cancelSignal: controller.signal,
      })`fireeth tools poll-rpc-blocks http://localhost:8545 0`.pipe({
        cancelSignal: controller.signal,
      })`tsx script/firehose.ts`.pipe({
        verbose: "full",
        cancelSignal: controller.signal,
      })`fireeth start reader-node-stdin,merger,relayer,substreams-tier1 --advertise-chain-name=anvil --config-file=`;
      // void $({
      //   verbose: "full",
      //   cancelSignal: controller.signal,
      //   cwd: "node_modules/@exactly/substreams",
      //   env: { SUBSTREAMS_ENDPOINTS_CONFIG_ANVIL: "localhost:10016" },
      //   // cspell:ignore sslmode
      // })`substreams-sink-sql run postgres://localhost:5432/postgres?schemaName=substreams&sslmode=disable \
      //     substreams.yaml --plaintext --batch-block-flush-interval 1 --batch-row-flush-interval 1`;

      const { default: app, close } = await import("../index");

      app.post("/e2e/coverage", async (c) => {
        await mkdir("coverage", { recursive: true });
        await writeFile("coverage/app.json", JSON.stringify(await c.req.json()));
        return c.json({ code: "ok" });
      });

      await expect(
        new Promise((resolve) => {
          function teardown() {
            controller.abort();
            void close().finally(() => resolve(null));
          }
          app.post("/e2e/shutdown", (c) => {
            teardown();
            return c.json({ code: "ok" });
          });
          process.once("SIGTERM", teardown);
        }),
      ).resolves.toBeNull();
    },
    /* eslint-enable no-void */
    Infinity,
  );
});

vi.mock("../utils/alchemy", async (importOriginal) => ({
  ...(await importOriginal()),
  findWebhook: vi.fn<() => Promise<void>>().mockResolvedValue(),
  createWebhook: vi
    .fn<() => Promise<{ id: string; signing_key: string }>>()
    .mockResolvedValue({ id: "123", signing_key: "123" }),
}));

vi.mock("../utils/panda", async (importOriginal) => ({
  ...(await importOriginal()),
  createUser: vi
    .fn<() => Promise<{ id: string }>>()
    .mockImplementation(() => Promise.resolve({ id: String(Math.random()) })), // eslint-disable-line @vitest/prefer-mock-promise-shorthand -- random
}));

vi.mock("../utils/persona", async (importOriginal) => ({
  ...(await importOriginal()),
  getInquiry: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));
