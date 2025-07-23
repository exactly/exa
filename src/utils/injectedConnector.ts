import chain from "@exactly/common/generated/chain";
import type { Credential } from "@exactly/common/validation";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isAddress, UserRejectedRequestError, type Address } from "viem";
import { createConfig, createStorage, custom } from "wagmi";

import publicClient from "./publicClient";
import queryClient from "./queryClient";
import reportError from "./reportError";

export const config = createConfig({
  chains: [chain],
  connectors: [miniAppConnector()],
  transports: { [chain.id]: custom(publicClient) },
  storage: createStorage({ storage: AsyncStorage }),
});

if (config.connectors[0]?.id !== "farcaster") throw new Error("no farcaster connector");
export const [connector] = config.connectors;

export async function connectAccount(account: Address) {
  const accounts = await connector.isAuthorized().then(async (isAuthorized) => {
    if (isAuthorized) return connector.getAccounts();
    const { accounts: connectedAccounts } = await connector.connect({ chainId: chain.id });
    return connectedAccounts;
  });
  if (!accounts.includes(account)) throw new Error("injected account mismatch");
  return account;
}

export async function getAccount() {
  try {
    const credential = queryClient.getQueryData<Credential>(["credential"]);
    if (credential) return isAddress(credential.credentialId) ? credential.credentialId : undefined;
    if (await connector.isAuthorized()) {
      const accounts = await connector.getAccounts();
      return accounts[0];
    }
    const { accounts } = await connector.connect({ chainId: chain.id });
    return accounts[0];
  } catch (error: unknown) {
    if (error instanceof UserRejectedRequestError) return;
    reportError(error);
  }
}

export async function hasProvider() {
  return await connector.isAuthorized().then(async () => {
    const provider = await connector.getProvider({ chainId: chain.id });
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return provider !== undefined;
  });
}
