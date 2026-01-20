/// <reference types="vite/client" />
import "./mocks/alchemy";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/onesignal";
import "./mocks/pax";
import "./mocks/redis";
import "./mocks/sardine";
import "./mocks/sentry";

import { cors } from "hono/cors";
import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";

import type * as sentry from "@sentry/node";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      const { default: app, close } = await import("../index");

      app.use("/e2e/*", cors());
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
