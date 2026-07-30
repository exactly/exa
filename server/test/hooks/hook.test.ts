/// <reference types="vite/client" />
import "../mocks/sentry";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(process.env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("hook", () => {
  it("loads the activity factory without process.env", async () => {
    await expect(import("../../hooks/activity").then(({ default: hook }) => hook)).resolves.toBeTypeOf("function");
  });

  it("loads the chat factory without process.env", async () => {
    await expect(import("../../hooks/chat").then(({ default: hook }) => hook)).resolves.toBeTypeOf("function");
  });
});
