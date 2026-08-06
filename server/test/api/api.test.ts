/// <reference types="vite/client" />
import "../mocks/sentry";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/wallet", () => ({ getWallet: vi.fn() }));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(process.env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("api", () => {
  it("loads the factory without process.env", async () => {
    await expect(import("../../api").then(({ default: api }) => api)).resolves.toBeTypeOf("function");
  });
});
