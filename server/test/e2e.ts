/// <reference types="vite/client" />
import "./mocks/sentry";
import "./mocks/database";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/redis";

import { mkdirSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      const { default: app, close } = await import("../index");

      app.post("/e2e/coverage", async (c) => {
        mkdirSync("coverage", { recursive: true });
        writeFileSync("coverage/app.json", JSON.stringify(await c.req.json()));
        return c.json({ code: "ok" });
      });

      await expect(
        new Promise((resolve) => {
          app.post("/e2e/shutdown", (c) => {
            close()
              .then(resolve)
              .catch(() => resolve(null));
            return c.json({ code: "ok" });
          });

          process.once("SIGTERM", () => {
            close()
              .then(resolve)
              .catch(() => resolve(null));
          });
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
