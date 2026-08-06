import "../mocks/sentry";

import { padHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import chain from "@exactly/common/generated/chain";

import { getAccount, getWallet } from "../../utils/wallet";

const signer = privateKeyToAccount(padHex("0x1234"));
const mocks = vi.hoisted(() => ({
  clients: [] as object[],
  close: vi.fn<() => Promise<void>>(),
  gcpHsmToAccount: vi.fn(),
  getProjectId: vi.fn<() => Promise<string>>(),
}));

vi.mock("@google-cloud/kms", () => ({
  KeyManagementServiceClient: class {
    constructor() {
      mocks.clients.push(this);
    }

    close = mocks.close;
    getProjectId = mocks.getProjectId;
  },
}));
vi.mock("@valora/viem-account-hsm-gcp", () => ({ gcpHsmToAccount: mocks.gcpHsmToAccount }));

beforeEach(() => {
  mocks.clients.length = 0;
  mocks.close.mockReset().mockResolvedValue();
  mocks.gcpHsmToAccount.mockReset();
  mocks.getProjectId.mockReset().mockResolvedValue("exa-test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("get wallet", () => {
  it("uses accounts", () => {
    expect(getWallet(signer).account).toBe(signer);
    expect(getWallet(signer, chain).account).toBe(signer);
  });
});

describe("get account", () => {
  it("uses private keys", async () => {
    await expect(getAccount("keeper").then(({ address }) => address)).resolves.toBe(
      privateKeyToAccount(padHex("0x69")).address,
    );
    expect(mocks.clients).toStrictEqual([]);
    expect(mocks.gcpHsmToAccount).not.toHaveBeenCalled();
  });

  it("fails for missing kms versions", async () => {
    const error = Object.assign(new Error("kms key version not found"), { code: 5 });
    mocks.gcpHsmToAccount.mockRejectedValueOnce(error);
    vi.stubEnv("GCP_KMS_KEY_RING", "sandbox-signers");
    vi.stubEnv("GCP_KMS_KEY_VERSION", "42");
    vi.stubEnv("GCP_KMS_LOCATION", "us-west1");

    await expect(getAccount("allower")).rejects.toBe(error);

    expect(mocks.gcpHsmToAccount).toHaveBeenCalledExactlyOnceWith({
      hsmKeyVersion:
        "projects/exa-test/locations/us-west1/keyRings/sandbox-signers/cryptoKeys/sandbox-allower/cryptoKeyVersions/42",
      kmsClient: mocks.clients[0],
    });
    expect(mocks.close).not.toHaveBeenCalled();
  });
});
