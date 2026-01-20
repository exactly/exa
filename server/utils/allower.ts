import { KeyManagementServiceClient } from "@google-cloud/kms";
import { captureException, captureMessage } from "@sentry/node";
import { gcpHsmToAccount } from "@valora/viem-account-hsm-gcp";
import { parse } from "valibot";
import { createWalletClient, http, withRetry } from "viem";

import alchemyAPIKey from "@exactly/common/alchemyAPIKey";
import chain, { firewallAbi, firewallAddress } from "@exactly/common/generated/chain";

import baseExtender from "./baseExtender";
import { GOOGLE_APPLICATION_CREDENTIALS, hasCredentials, initializeGcpCredentials, isRetryableKmsError } from "./gcp";
import nonceManager from "./nonceManager";
import { captureRequests, Requests } from "./publicClient";

import type { Address } from "@exactly/common/validation";
import type { HttpTransport, LocalAccount, WalletClient } from "viem";

if (!chain.rpcUrls.alchemy.http[0]) throw new Error("missing alchemy rpc url");
const rpcUrl = chain.rpcUrls.alchemy.http[0];

if (!process.env.GCP_PROJECT_ID) throw new Error("GCP_PROJECT_ID is required when using GCP KMS");
const projectId = process.env.GCP_PROJECT_ID;
if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
  throw new Error("GCP_PROJECT_ID must be a valid GCP project ID format");
}

if (!process.env.GCP_KMS_KEY_RING) throw new Error("GCP_KMS_KEY_RING is required when using GCP KMS");
const keyRing = process.env.GCP_KMS_KEY_RING;
if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("GCP_KMS_KEY_VERSION is required when using GCP KMS");
const version = process.env.GCP_KMS_KEY_VERSION;
if (!/^\d+$/.test(version)) throw new Error("GCP_KMS_KEY_VERSION must be a numeric version number");

export async function getAccount(): Promise<LocalAccount> {
  await initializeGcpCredentials();

  if (!(await hasCredentials())) {
    throw new Error(
      `gcp credentials file not found at ${GOOGLE_APPLICATION_CREDENTIALS}. ` +
        `ensure GCP_BASE64_JSON environment variable is set.`,
    );
  }

  try {
    const account = await withRetry(
      () =>
        gcpHsmToAccount({
          hsmKeyVersion: `projects/${projectId}/locations/us-west2/keyRings/${keyRing}/cryptoKeys/allower/cryptoKeyVersions/${version}`,
          kmsClient: new KeyManagementServiceClient({
            keyFilename: GOOGLE_APPLICATION_CREDENTIALS,
          }),
        }),
      {
        delay: 2000,
        retryCount: 3,
        shouldRetry: ({ error }) => isRetryableKmsError(error),
      },
    );

    account.nonceManager = nonceManager;
    return account;
  } catch (error: unknown) {
    captureException(error, { level: "error" });
    throw error;
  }
}

export default async function allower() {
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
    account: await getAccount(),
  }).extend((client: WalletClient<HttpTransport, typeof chain, LocalAccount>) => {
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
  });
}
