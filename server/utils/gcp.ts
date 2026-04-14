import { KeyManagementServiceClient } from "@google-cloud/kms";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { access, writeFile } from "node:fs/promises";
import { parse } from "valibot";
import { createWalletClient, http } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";

import { extender } from "./keeper";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

const DECODE_DEPTH = 3;
const CREDENTIALS_PATH = "/tmp/gcp-service-account.json";

if (!process.env.GCP_BASE64_JSON) throw new Error("missing gcp base64 json");
const encoded = process.env.GCP_BASE64_JSON;

if (!process.env.GCP_PROJECT_ID) throw new Error("missing gcp project id");
if (!process.env.GCP_KMS_KEY_RING) throw new Error("missing gcp kms key ring");
if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("missing gcp kms key version");
const projectId = process.env.GCP_PROJECT_ID;
const keyRing = process.env.GCP_KMS_KEY_RING;
const version = process.env.GCP_KMS_KEY_VERSION;

let pending: null | Promise<string> = null;

function setupCredentials() {
  return (pending ??= (async () => {
    const exists = await access(CREDENTIALS_PATH)
      .then(() => true)
      .catch(() => false);
    if (!exists) {
      let json = encoded;
      for (let index = 0; index < DECODE_DEPTH; index++) {
        json = Buffer.from(json, "base64").toString("utf8");
      }
      await writeFile(CREDENTIALS_PATH, json, { mode: 0o600 });
    }
    return CREDENTIALS_PATH;
  })().catch((error: unknown) => {
    pending = null;
    throw error;
  }));
}

// eslint-disable-next-line import/prefer-default-export
export async function kms(key: string) {
  const account = await gcpHsmToAccount({
    hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${keyRing}/cryptoKeys/${key}/cryptoKeyVersions/${version}`,
    kmsClient: new KeyManagementServiceClient({ keyFilename: await setupCredentials() }),
  });
  account.nonceManager = nonceManager;
  return extender(
    createWalletClient({
      chain,
      transport: http(`${chain.rpcUrls.alchemy.http[0]}/${alchemyAPIKey}`, {
        batch: true,
        async onFetchRequest(request) {
          captureRequests(parse(Requests, await request.json()));
        },
      }),
      account,
    }),
  );
}
