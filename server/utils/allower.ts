import { KeyManagementServiceClient } from "@google-cloud/kms";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { parse } from "valibot";
import { createWalletClient, http, withRetry } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Hash } from "@exactly/common/validation";

import {
  GOOGLE_APPLICATION_CREDENTIALS,
  hasCredentials,
  initializeGcpCredentials,
  isRetryableKmsError,
  trackKmsOperation,
  validateGcpConfiguration,
} from "./gcp";
import { extender } from "./keeper";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

import type { LocalAccount } from "viem";

const gcpKmsKeyName = "allower";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");
const rpcUrl = chain.rpcUrls.alchemy.http[0];

// validate configuration at module load
validateGcpConfiguration();

export async function getAccount(): Promise<LocalAccount> {
  if (process.env.GCP_PROJECT_ID) {
    const projectId = process.env.GCP_PROJECT_ID;

    if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("missing gcp kms key version");
    const version = process.env.GCP_KMS_KEY_VERSION;

    if (!process.env.GCP_KMS_KEY_RING) throw new Error("missing gcp kms key ring");
    const gcpKmsKeyRing = process.env.GCP_KMS_KEY_RING;

    // initialize credentials first
    await initializeGcpCredentials();

    // verify credentials file exists at expected path
    if (!(await hasCredentials())) {
      throw new Error(
        `gcp credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
          `ensure GCP_BASE64_JSON environment variable is set.`,
      );
    }

    // create kms client with explicit credentials file path
    const kmsClient = new KeyManagementServiceClient({
      keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
    });

    try {
      const account = await withRetry(
        () =>
          gcpHsmToAccount({
            hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${gcpKmsKeyRing}/cryptoKeys/${gcpKmsKeyName}/cryptoKeyVersions/${version}`,
            kmsClient,
          }),
        {
          delay: 2000,
          retryCount: 3,
          shouldRetry: ({ error }) => isRetryableKmsError(error),
        },
      );

      trackKmsOperation("get_account", true);
      account.nonceManager = nonceManager;
      return account;
    } catch (error) {
      trackKmsOperation("get_account", false, error);
      throw error;
    }
  } else {
    if (!process.env.KEEPER_PRIVATE_KEY) throw new Error("missing keeper private key");
    return privateKeyToAccount(parse(Hash, process.env.KEEPER_PRIVATE_KEY, { message: "invalid keeper private key" }), {
      nonceManager,
    });
  }
}

export default async function createAllower() {
  const account = await getAccount();
  return createWalletClient({
    chain,
    transport: http(`${rpcUrl}/${alchemyAPIKey}`, {
      batch: true,
      async onFetchRequest(request) {
        captureRequests(parse(Requests, await request.json()));
      },
    }),
    account,
  }).extend(extender);
}
