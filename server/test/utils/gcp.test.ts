import { access, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeGcpCredentials, resetGcpInitialization } from "../../utils/gcp";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
  access: vi.fn(),
}));

const mockWriteFile = vi.mocked(writeFile);
const mockAccess = vi.mocked(access);

describe("gcp credentials security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // cspell:ignore unstub
    vi.unstubAllEnvs();
    resetGcpInitialization();
    mockAccess.mockRejectedValue(new Error("File not found"));
  });

  it("creates credentials file with secure permissions (0o600)", async () => {
    vi.stubEnv("GCP_BASE64_JSON", "WlhsS01HVllRbXhKYW05blNXNU9iR051V25CWk1sWm1XVmRPYW1JelZuVmtRMG81UTJjOVBRbz0K");

    await initializeGcpCredentials();

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/gcp-service-account.json", expect.any(String), {
      mode: 0o600,
    });
  });

  it("throws error when GCP_PROJECT_ID is set but GCP_BASE64_JSON is missing", async () => {
    vi.stubEnv("GCP_PROJECT_ID", "test-project");
    vi.stubEnv("GCP_BASE64_JSON", "");

    await expect(initializeGcpCredentials()).rejects.toThrow(
      "gcp project configured but GCP_BASE64_JSON environment variable is not set",
    );
  });
});
