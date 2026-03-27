import { access, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initializeGcpCredentials, isRetryableKmsError, resetGcpInitialization } from "../../utils/gcp";

vi.mock("node:fs/promises", () => ({
  writeFile: vi.fn(),
  access: vi.fn(),
}));

const mockWriteFile = vi.mocked(writeFile);
const mockAccess = vi.mocked(access);

describe("gcp credentials security", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetGcpInitialization();
    mockAccess.mockRejectedValue(new Error("File not found"));
  });

  it("creates credentials file with secure permissions (0o600)", async () => {
    await initializeGcpCredentials();

    expect(mockWriteFile).toHaveBeenCalledWith("/tmp/gcp-service-account.json", expect.any(String), {
      mode: 0o600,
    });
  });

  it("returns early when credentials already exist", async () => {
    mockAccess.mockResolvedValue();

    await initializeGcpCredentials();

    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});

describe("isRetryableKmsError", () => {
  it("returns false for non-Error values", () => {
    expect(isRetryableKmsError("string")).toBe(false);
    expect(isRetryableKmsError(null)).toBe(false);
    expect(isRetryableKmsError(42)).toBe(false);
  });

  it("returns true for numeric gRPC codes (14, 4, 13, 8)", () => {
    for (const code of [14, 4, 13, 8]) {
      const error = Object.assign(new Error("grpc error"), { code });
      expect(isRetryableKmsError(error)).toBe(true);
    }
  });

  it("returns false for non-retryable numeric codes", () => {
    const error = Object.assign(new Error("grpc error"), { code: 3 });
    expect(isRetryableKmsError(error)).toBe(false);
  });

  it("returns true for string gRPC codes", () => {
    for (const code of ["UNAVAILABLE", "DEADLINE_EXCEEDED", "INTERNAL", "RESOURCE_EXHAUSTED"]) {
      const error = Object.assign(new Error("grpc error"), { code });
      expect(isRetryableKmsError(error)).toBe(true);
    }
  });

  it("returns false for non-retryable string codes", () => {
    const error = Object.assign(new Error("grpc error"), { code: "PERMISSION_DENIED" });
    expect(isRetryableKmsError(error)).toBe(false);
  });

  it("returns true for retryable message substrings", () => {
    for (const message of ["network error", "request timeout", "service unavailable", "internal error occurred"]) {
      expect(isRetryableKmsError(new Error(message))).toBe(true);
    }
  });

  it("returns true for retryable error names", () => {
    const networkError = new Error("fail");
    networkError.name = "NetworkError";
    expect(isRetryableKmsError(networkError)).toBe(true);

    const timeoutError = new Error("fail");
    timeoutError.name = "TimeoutError";
    expect(isRetryableKmsError(timeoutError)).toBe(true);
  });

  it("returns false for generic errors without retryable signals", () => {
    expect(isRetryableKmsError(new Error("something went wrong"))).toBe(false);
  });
});
