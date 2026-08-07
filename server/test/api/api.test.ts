/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/wallet", () => ({ getWallet: vi.fn() }));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("api", () => {
  it("loads the factory without environment variables", async () => {
    await expect(import("../../api").then(({ default: api }) => api)).resolves.toBeTypeOf("function");
  });
});
