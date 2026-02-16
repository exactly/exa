import Redis from "ioredis-mock";

import { vi } from "vitest";

vi.mock("ioredis", () => ({ default: Redis, Redis }));
