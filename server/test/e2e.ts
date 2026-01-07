/// <reference types="vite/client" />
import "./mocks/sentry";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/redis";

import type * as sentry from "@sentry/node";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      const { default: app, close } = await import("../index");

      app.post("/e2e/coverage", async (c) => {
        await mkdir("coverage", { recursive: true });
        await writeFile("coverage/app.json", JSON.stringify(await c.req.json()));
        return c.json({ code: "ok" });
      });

      await expect(
        new Promise((resolve) => {
          const teardown = () => void close().finally(() => resolve(null)); // eslint-disable-line no-void
          app.post("/e2e/shutdown", (c) => {
            teardown();
            return c.json({ code: "ok" });
          });
          process.once("SIGTERM", teardown);
        }),
      ).resolves.toBeNull();
    },
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
    .mockImplementation(() => Promise.resolve({ id: String(Math.random()) })),
}));

vi.mock("../utils/persona", async (importOriginal) => ({
  ...(await importOriginal()),
  getInquiry: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));

vi.mock("@sentry/node", async (importOriginal) => {
  const { captureException, ...original } = await importOriginal<typeof sentry>();
  return {
    ...original,
    captureException(...args: Parameters<typeof sentry.captureException>) {
      console.log(...args); // eslint-disable-line no-console
      return captureException(...args);
    },
  };
});
