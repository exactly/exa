import { createRequire } from "node:module";
import { beforeEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);

const mocks = vi.hoisted(() => ({
  accessSecretVersion: vi.fn<(request: { name: string }) => Promise<[{ payload?: { data?: Buffer } }]>>(),
  getProjectId: vi.fn<() => Promise<string>>(),
}));

vi.mock("@google-cloud/secret-manager", () => ({
  SecretManagerServiceClient: class {
    accessSecretVersion = mocks.accessSecretVersion;
    getProjectId = mocks.getProjectId;
  },
}));

describe("secret", () => {
  beforeEach(() => {
    vi.resetModules();
    mocks.accessSecretVersion.mockReset().mockResolvedValue([{ payload: { data: Buffer.from("secret-value") } }]);
    mocks.getProjectId.mockReset().mockResolvedValue("exa-test");
    delete process.env.APP_DOMAIN;
    process.env.APP_STACK = "sandbox";
    delete process.env.EXPO_PUBLIC_DOMAIN;
    delete process.env.EXPO_PUBLIC_STACK;
  });

  it("loads secret manager values through adc project detection and app stack", async () => {
    await expect((await load())("redis-url")).resolves.toBe("secret-value");

    expect(mocks.getProjectId).toHaveBeenCalledTimes(1);
    expect(mocks.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/exa-test/secrets/sandbox-redis-url/versions/latest",
    });
  });

  it("loads production stack secrets", async () => {
    process.env.APP_STACK = "production";

    const secret = await load();
    await secret("account-alchemy-webhooks-key");

    expect(mocks.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/exa-test/secrets/production-account-alchemy-webhooks-key/versions/latest",
    });
  });

  it("loads preview stack secrets", async () => {
    process.env.APP_STACK = "preview";

    const secret = await load();
    await secret("redis-url");

    expect(mocks.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/exa-test/secrets/preview-redis-url/versions/latest",
    });
  });

  it("loads public stack secrets before app stack secrets", async () => {
    process.env.APP_STACK = "sandbox";
    process.env.EXPO_PUBLIC_STACK = "preview";

    const secret = await load();
    await secret("redis-url");

    expect(mocks.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/exa-test/secrets/preview-redis-url/versions/latest",
    });
  });

  it("loads legacy domain fallback secrets", async () => {
    delete process.env.APP_STACK;
    process.env.APP_DOMAIN = "web.exactly.app";

    const secret = await load();
    await secret("redis-url");

    expect(mocks.accessSecretVersion).toHaveBeenCalledWith({
      name: "projects/exa-test/secrets/production-redis-url/versions/latest",
    });
  });

  it("fails on missing secret payloads", async () => {
    mocks.accessSecretVersion.mockResolvedValueOnce([{}]);

    const secret = await load();
    await expect(secret("redis-url")).rejects.toThrow("missing secret redis-url");
  });

  it("fails when legacy domain fallback is not stack shaped", async () => {
    delete process.env.APP_STACK;
    process.env.APP_DOMAIN = "api.sandbox.exactly.app";

    await expect(load()).rejects.toThrow("missing app stack");
    expect(mocks.accessSecretVersion).not.toHaveBeenCalled();
  });
});

async function load() {
  Reflect.deleteProperty(require.cache, require.resolve("@exactly/common/domain"));
  Reflect.deleteProperty(require.cache, require.resolve("@exactly/common/stack"));
  const current = await import("../../utils/secret");
  return current.default;
}
