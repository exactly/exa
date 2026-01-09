import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain from "@exactly/common/generated/chain";
import { Hash } from "@exactly/common/validation";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { parse } from "valibot";
import { createWalletClient, http, type LocalAccount } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { extender } from "./keeper";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

if (!chain.rpcUrls.alchemy?.http[0]) throw new Error("missing alchemy rpc url");
const rpcUrl = chain.rpcUrls.alchemy.http[0];

const getAccount = async (): Promise<LocalAccount> => {
  if (process.env.GCP_KMS_PROJECT_ID) {
    const projectId = process.env.GCP_KMS_PROJECT_ID;

    if (!process.env.GCP_KMS_LOCATION) throw new Error("missing gcp kms location");
    const location = process.env.GCP_KMS_LOCATION;

    if (!process.env.GCP_KMS_KEY_RING) throw new Error("missing gcp kms key ring");
    const keyRing = process.env.GCP_KMS_KEY_RING;

    if (!process.env.GCP_KMS_KEY_NAME) throw new Error("missing gcp kms key name");
    const key = process.env.GCP_KMS_KEY_NAME;

    if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("missing gcp kms key version");
    const version = process.env.GCP_KMS_KEY_VERSION;

    const account = await gcpHsmToAccount({
      hsmKeyVersion: `projects/${projectId}/locations/${location}/keyRings/${keyRing}/cryptoKeys/${key}/cryptoKeyVersions/${version}`,
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
|||||||
