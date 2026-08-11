/// <reference types="vite/client" />
import "../mocks/sentry";

import { env } from "node:process";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/wallet", () => ({ default: vi.fn() }));

afterAll(() => {
  vi.unstubAllEnvs();
});

beforeAll(() => {
  vi.resetModules();
  for (const name of Object.keys(env)) vi.stubEnv(name, undefined); // eslint-disable-line unicorn/no-useless-undefined
});

describe("hook", () => {
  it.each([
    ["activity", () => import("../../hooks/activity")],
    ["block", () => import("../../hooks/block")],
    ["bridge", () => import("../../hooks/bridge")],
    ["manteca", () => import("../../hooks/manteca")],
    ["panda", () => import("../../hooks/panda")],
    ["persona", () => import("../../hooks/persona")],
  ])("loads the %s factory without environment variables", async (_, load) => {
    await expect(load().then(({ default: hook }) => hook)).resolves.toBeTypeOf("function");
  });
});
