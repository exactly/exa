import chain from "@exactly/common/generated/chain";
import type { Credential } from "@exactly/common/validation";
import { sdk } from "@farcaster/miniapp-sdk";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setContext } from "@sentry/react-native";
import { injected } from "@wagmi/core";
import { isAddress, UserRejectedRequestError, type Address } from "viem";
import { createConfig, createStorage, custom } from "wagmi";

import publicClient from "./publicClient";
import reportError from "./reportError";

export const config = createConfig({
  chains: [chain],
  connectors: [miniAppConnector(), injected()],
  transports: { [chain.id]: custom(publicClient) },
  storage: createStorage({ storage: AsyncStorage }),
});

export async function connectAccount(account: Address) {
  const connector = await getConnector();
  const accounts = await connector.isAuthorized().then(async (isAuthorized) => {
    if (isAuthorized) return connector.getAccounts();
    const { accounts: connectedAccounts } = await connector.connect({ chainId: chain.id });
    return connectedAccounts;
  });
  if (!accounts.includes(account)) {
    setContext("injected", { account, accounts, connector: connector.id });
    throw new Error("injected account mismatch");
  }
  return account;
}

export async function getAccount(credential?: Credential) {
  try {
    if (credential) return isAddress(credential.credentialId) ? credential.credentialId : undefined;
    const connector = await getConnector();
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

export async function getConnector() {
  const miniApp = await sdk.isInMiniApp();
  const connector = miniApp
    ? config.connectors.find((c) => c.id === "farcaster")
    : config.connectors.find((c) => c.id === "injected");
  if (!connector) throw new Error("no connector available");
  return connector;
}

export async function hasProvider() {
  const connector = await getConnector();
  if (connector.id === "injected") await connector.isAuthorized();
  const provider = await connector.getProvider({ chainId: chain.id });
  return provider !== undefined;
}
