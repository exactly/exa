import chain from "@exactly/common/generated/chain";
import type { Credential } from "@exactly/common/validation";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { injected } from "@wagmi/core";
import { isAddress, UserRejectedRequestError, type Address } from "viem";
import { createConfig, createStorage, custom } from "wagmi";

import publicClient from "./publicClient";
import queryClient from "./queryClient";
import reportError from "./reportError";

export const config = createConfig({
  chains: [chain],
  connectors: [miniAppConnector(), injected()],
  transports: { [chain.id]: custom(publicClient) },
  storage: createStorage({ storage: AsyncStorage }),
});

export async function getAvailableConnector() {
  for (const availableConnector of config.connectors) {
    const isAuthorized = await availableConnector.isAuthorized();
    if (isAuthorized) return availableConnector;
  }
  return config.connectors.find((c) => c.id === "injected") ?? config.connectors.find((c) => c.id === "farcaster");
}

export async function getActiveConnector() {
  for (const connector of config.connectors) {
    const isAuthorized = await connector.isAuthorized();
    if (isAuthorized) {
      const accounts = await connector.getAccounts();
      if (accounts.length > 0) return connector;
    }
  }
  return null;
}

export async function connectAccount(account: Address) {
  const availableConnector = await getAvailableConnector();
  if (!availableConnector) throw new Error("no connector available");
  const accounts = await availableConnector.isAuthorized().then(async (isAuthorized) => {
    if (isAuthorized) return availableConnector.getAccounts();
    const { accounts: connectedAccounts } = await availableConnector.connect({ chainId: chain.id });
    return connectedAccounts;
  });
  if (!accounts.includes(account)) throw new Error("injected account mismatch");
  return account;
}

export async function getAccount() {
  try {
    const credential = queryClient.getQueryData<Credential>(["credential"]);
    if (credential) return isAddress(credential.credentialId) ? credential.credentialId : undefined;

    const availableConnector = await getAvailableConnector();
    if (!availableConnector) return;

    if (await availableConnector.isAuthorized()) {
      const accounts = await availableConnector.getAccounts();
      return accounts[0];
    }
    const { accounts } = await availableConnector.connect({ chainId: chain.id });
    return accounts[0];
  } catch (error: unknown) {
    if (error instanceof UserRejectedRequestError) return;
    reportError(error);
  }
}

export async function hasProvider() {
  for (const availableConnector of config.connectors) {
    if (availableConnector.id === "injected") {
      const provider = await availableConnector.getProvider({ chainId: chain.id });
      if (provider !== undefined) {
        return true;
      }
    } else if (availableConnector.id === "farcaster") {
      const isAuthorized = await availableConnector.isAuthorized();
      if (isAuthorized) {
        const provider = await availableConnector.getProvider({ chainId: chain.id });
        return provider !== undefined;
      }
    }
  }
  return false;
}
