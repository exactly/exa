import { access, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
  access: vi.fn(),
}));

vi.mock("@google-cloud/kms", () => ({ KeyManagementServiceClient: vi.fn() }));
vi.mock("@valora/viem-account-hsm-gcp", () => ({ gcpHsmToAccount: vi.fn().mockResolvedValue({}) }));

const mockWriteFile = vi.mocked(writeFile);
const mockAccess = vi.mocked(access);

describe("kms", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mockAccess.mockRejectedValue(new Error("not found"));
  });

  it("writes credentials with secure permissions", async () => {
    const { kms } = await import("../../utils/gcp");
    await kms("allower");

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/gcp-service-account.json", expect.any(String), { mode: 0o600 });
  });

  it("skips writing when credentials already exist", async () => {
    mockAccess.mockResolvedValue();
    const { kms } = await import("../../utils/gcp");
    await kms("allower");

    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it("caches credentials across calls", async () => {
    const { kms } = await import("../../utils/gcp");
    await Promise.all([kms("allower"), kms("allower")]);

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
  });
});
