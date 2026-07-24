import { afterEach, beforeEach, describe, it, vi } from "vitest";

import type secret from "../../utils/secret";
import type { signer } from "../../utils/wallet";

const mocks = {
  close: vi.fn<() => Promise<void>>(),
  secret: vi.fn<typeof secret>(),
  signer: vi.fn<typeof signer>(),
  supervise: vi.fn<(name: string, created: Promise<Handle>) => void>(),
};

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  vi.resetModules();
  mocks.close.mockReset().mockResolvedValue();
  mocks.secret.mockReset().mockImplementation((name) => Promise.resolve(name));
  mocks.signer.mockReset();
  mocks.supervise.mockReset();
  vi.doMock("../../supervise", () => ({ default: mocks.supervise }));
  vi.doMock("../../utils/secret", () => ({ default: mocks.secret }));
  vi.doMock("../../utils/wallet", () => ({ signer: mocks.signer }));
});

describe("bin", () => {
  it.todo("constructs and supervises workers with private config");
});

type Handle = {
  close(): Promise<void>;
  ready: Promise<void>;
};
