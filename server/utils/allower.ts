import { KeyManagementServiceClient } from "@google-cloud/kms";
import { captureMessage } from "@sentry/node";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { parse } from "valibot";
import { createWalletClient, http, withRetry } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";

import baseExtender from "./baseExtender";
import {
  GOOGLE_APPLICATION_CREDENTIALS,
  hasCredentials,
  initializeGcpCredentials,
  isRetryableKmsError,
  trackKmsOperation,
} from "./gcp";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

import type { Address } from "@exactly/common/validation";
import type { HttpTransport, LocalAccount, WalletClient } from "viem";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");
const rpcUrl = chain.rpcUrls.alchemy.http[0];

export async function getAccount(): Promise<LocalAccount> {
  if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required for allower");
  const projectId = process.env.GCP_PROJECT_ID;

  if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("missing gcp kms key version");
  const version = process.env.GCP_KMS_KEY_VERSION;

  if (!process.env.GCP_KMS_KEY_RING) throw new Error("missing gcp kms key ring");
  const gcpKmsKeyRing = process.env.GCP_KMS_KEY_RING;

  await initializeGcpCredentials();

  if (!(await hasCredentials())) {
    throw new Error(
      `gcp credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
        `ensure GCP_BASE64_JSON environment variable is set.`,
    );
  }

  const kmsClient = new KeyManagementServiceClient({
    keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
  });

  try {
    const account = await withRetry(
      () =>
        gcpHsmToAccount({
          hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${gcpKmsKeyRing}/cryptoKeys/allower/cryptoKeyVersions/${version}`,
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
}

function allowerExtender(client: WalletClient<HttpTransport, typeof chain, LocalAccount>) {
  const base = baseExtender(client);
  return {
    ...base,
    allow: async (account: Address, options?: { ignore?: string[] }) => {
      if (!firewallAddress) throw new Error("firewall address not configured");
      return base.exaSend(
        { forceTransaction: true, name: "firewall.allow", op: "exa.firewall", attributes: { account } },
        {
          address: firewallAddress,
          functionName: "allow",
          args: [account, true],
          abi: firewallAbi,
        },
        options?.ignore ? { ignore: options.ignore } : undefined,
      );
    },
  };
}

export default async function allower() {
  const account = await getAccount();
  return createWalletClient({
    chain,
    transport: http(`${rpcUrl}/${alchemyAPIKey}`, {
      batch: true,
      async onFetchRequest(request) {
        try {
          captureRequests(parse(Requests, await request.clone().json()));
        } catch (error: unknown) {
          captureMessage("failed to parse or capture rpc requests", {
            level: "error",
            extra: { error },
          });
        }
      },
    }),
    account,
  }).extend(allowerExtender);
}
