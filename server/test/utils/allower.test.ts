import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getAccount } from "../../utils/allower";

import type * as accounts from "viem/accounts";

function mockGcp() {
  return {
    GOOGLE_APPLICATION_CREDENTIALS: "/tmp/gcp-service-account.json",
    hasCredentials: vi.fn().mockResolvedValue(true),
    initializeGcpCredentials: vi.fn().mockImplementation(() => Promise.resolve()),
    validateGcpConfiguration: vi.fn(),
    isRetryableKmsError: vi.fn().mockReturnValue(false),
    trackKmsOperation: vi.fn(),
  };
}

function mockViemHsm() {
  return {
    gcpHsmToAccount: vi.fn().mockResolvedValue({ address: "0xGCPAccount", source: "gcpHsm", type: "local" }),
  };
}

async function mockViemAccounts(importOriginal: () => Promise<typeof accounts>) {
  const actual = await importOriginal();
  return {
    ...actual,
    privateKeyToAccount: vi.fn(actual.privateKeyToAccount),
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

vi.mock("viem/accounts", mockViemAccounts);

vi.mock("@google-cloud/kms", mockKms);

describe("getAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // cspell:ignore unstub
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    // cspell:ignore unstub
    vi.unstubAllEnvs();
  });

  it("uses Private Key account when GCP_PROJECT_ID is missing", async () => {
    const privateKey = generatePrivateKey();
    vi.stubEnv("GCP_PROJECT_ID", "");
    vi.stubEnv("KEEPER_PRIVATE_KEY", privateKey);

    const account = await getAccount();

    expect(gcpHsmToAccount).not.toHaveBeenCalled();
    expect(privateKeyToAccount).toHaveBeenCalled();
    expect(account.address).toBe(privateKeyToAccount(privateKey).address);
    expect(account.nonceManager).toBeDefined();
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
