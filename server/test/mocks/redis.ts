import Redis from "ioredis-mock";

import { vi } from "vitest";

vi.mock("ioredis", () => ({ default: Redis, Redis }));
vi.mock("bullmq", () => ({
  Queue: vi.fn(function () {
    return { add: vi.fn().mockResolvedValue({}), close: vi.fn().mockResolvedValue(undefined) }; // eslint-disable-line unicorn/no-useless-undefined
  }),
  Worker: vi.fn(function () {
    return { on: vi.fn().mockReturnThis(), close: vi.fn().mockResolvedValue(undefined) }; // eslint-disable-line unicorn/no-useless-undefined
  }),
}));
