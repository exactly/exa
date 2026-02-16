/// <reference types="vite/client" />
import "../mocks/sentry";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const workers = Object.entries(import.meta.glob<{ default: unknown }>("../../workers/*/worker.ts"));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(process.env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("worker", () => {
  it("discovers workers", () => {
    expect(workers.length).toBeGreaterThan(0);
  });

  it.each(workers)("%s loads without process.env", async (_, load) => {
    await expect(load().then(({ default: worker }) => worker)).resolves.toBeTypeOf("function");
  });
});
