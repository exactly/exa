import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAccount } from "../../utils/allower";

function mockGcp() {
  return {
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/gcp-service-account.json",
    hasCredentials: vi.fn().mockResolvedValue(true),
    initializeGcpCredentials: vi.fn().mockImplementation(() => Promise.resolve()),
    isRetryableKmsError: vi.fn().mockReturnValue(false),
    trackKmsOperation: vi.fn(),
  };
}

function mockViemHsm() {
  return {
    gcpHsmToAccount: vi
      .fn()
      .mockResolvedValue({ address: "0x1234567890123456789012345678901234567890", source: "gcpHsm", type: "local" }),
  };
}

function mockKms() {
  return {
    KeyManagementServiceClient: vi.fn(function MockKeyManagementServiceClient() {
      return {};
    }),
  };
}

vi.mock("../../utils/gcp", mockGcp);

vi.mock("@valora/viem-account-hsm-gcp", mockViemHsm);

vi.mock("@google-cloud/kms", mockKms);

describe("getAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // cspell:ignore unstub
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when GCP_PROJECT_ID is missing", async () => {
    vi.stubEnv("GCP_PROJECT_ID", "");

    await expect(getAccount()).rejects.toThrow("GCP_PROJECT_ID is required for allower");
  });

  it("uses GCP HSM account when GCP_PROJECT_ID is present", async () => {
    vi.stubEnv("GCP_PROJECT_ID", "test-project");
    vi.stubEnv("GCP_KMS_KEY_RING", "test-ring");
    vi.stubEnv("GCP_KMS_KEY_VERSION", "1");

    const account = await getAccount();

    expect(gcpHsmToAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        hsmKeyVersion:
          "projects/test-project/locations/us-west2/keyRings/test-ring/cryptoKeys/allower/cryptoKeyVersions/1",
      }),
    );
    expect(account.nonceManager).toBeDefined();
  });
});
