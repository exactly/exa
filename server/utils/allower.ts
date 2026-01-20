import { KeyManagementServiceClient } from "@google-cloud/kms";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { existsSync } from "node:fs";
import { parse } from "valibot";
import { createWalletClient, http, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Hash } from "@exactly/common/validation";

import { GOOGLE_APPLICATION_CREDENTIALS } from "./initGCP";
import { extender } from "./keeper";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

const GCP_KMS_KEY_NAME = "allower";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");
const rpcUrl = chain.rpcUrls.alchemy.http[0];

if (!process.env.GCP_KMS_KEY_RING) throw new Error("missing gcp kms key ring");
const gcpKmsKeyRing = process.env.GCP_KMS_KEY_RING;

export const getAccount = async (): Promise<LocalAccount> => {
  if (process.env.GCP_PROJECT_ID) {
    const projectId = process.env.GCP_PROJECT_ID;

    if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("missing gcp kms key version");
    const version = process.env.GCP_KMS_KEY_VERSION;

    // Verify credentials file exists at expected path
    if (!existsSync(GOOGLE_APPLICATION_CREDENTIALS)) {
      throw new Error(
        `gcp credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
          `ensure GCP_BASE64_JSON environment variable is set.`,
      );
    }

    // Create KMS client with explicit credentials file path
    const kmsClient = new KeyManagementServiceClient({
      keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
    });

    const account = await gcpHsmToAccount({
      hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${gcpKmsKeyRing}/cryptoKeys/${GCP_KMS_KEY_NAME}/cryptoKeyVersions/${version}`,
      kmsClient, // Pass custom client with credentials path
    });
    account.nonceManager = nonceManager;
    return account;
  } else {
    if (!process.env.KEEPER_PRIVATE_KEY) throw new Error("missing keeper private key");
    return privateKeyToAccount(parse(Hash, process.env.KEEPER_PRIVATE_KEY, { message: "invalid keeper private key" }), {
      nonceManager,
    });
  }
};

export default (async () => {
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
})();
