import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalAccount } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type * as accounts from "viem/accounts";

import { getAccount } from "../../utils/allower";

// Mock gcpHsmToAccount
vi.mock("@valora/viem-account-hsm-gcp", () => ({
  gcpHsmToAccount: vi.fn().mockResolvedValue({ address: "0xGCPAccount", source: "gcpHsm", type: "local" }),
}));

// Mock privateKeyToAccount to spy on it
vi.mock("viem/accounts", async (importOriginal) => {
  const actual = await importOriginal<typeof accounts>();
  return {
    ...actual,
    privateKeyToAccount: vi.fn(actual.privateKeyToAccount),
  };
});

describe("getAccount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses GCP HSM account by default (from vitest config)", async () => {
    const mockGcpAccount = {
      address: "0xGCPAccount",
      source: "gcpHsm",
      type: "local",
    } as unknown as LocalAccount & { source: "gcpHsm" };

    vi.mocked(gcpHsmToAccount).mockImplementation(() => Promise.resolve(mockGcpAccount));

    const account = await getAccount();

    expect(gcpHsmToAccount).toHaveBeenCalledWith({
      hsmKeyVersion: "projects/exa-dev/locations/us-west2/keyRings/op-sepolia/cryptoKeys/allower/cryptoKeyVersions/1",
    });

    expect(account.address).toBe("0xGCPAccount");
    expect(account.nonceManager).toBeDefined();
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
});
