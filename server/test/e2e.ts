/// <reference types="vite/client" />
import "./mocks/sentry";
import "./mocks/database";
import "./mocks/deployments";
import "./mocks/keeper";
import "./mocks/redis";

import { captureException, captureMessage, logger } from "@sentry/node";
import { describe, expect, it, vi } from "vitest";

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

describe("e2e", () => {
  it(
    "runs server",
    async () => {
      logger.warn("test spotlight logger");
      captureMessage("test spotlight captureMessage");
      captureException(new Error("test spotlight captureException"), { extra: { test: "opa" } });
      vi.resetModules();
      const { default: closeServer } = await import("../index");

      await expect(
        new Promise((resolve, reject) => {
          if (import.meta.hot) {
            import.meta.hot.dispose(() => {
              closeServer().then(resolve).catch(reject);
            });
          }
        }),
      ).resolves.toBeNull();
    },
    Infinity,
  );
});
