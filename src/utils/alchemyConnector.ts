import { getAddress, SwitchChainError, type Chain, type Transport } from "viem";
import { ChainNotConfiguredError, createConnector } from "wagmi";

import deriveAddress from "@exactly/common/deriveAddress";
import chain from "@exactly/common/generated/chain";

import createAccountClient from "./accountClient";
import publicClient from "./publicClient";
import queryClient from "./queryClient";
import reportError from "./reportError";

import type { SmartAccountClient, SmartContractAccount } from "@aa-sdk/core";
import type { ClientWithAlchemyMethods } from "@account-kit/infra";
import type { Credential } from "@exactly/common/validation";

export let accountClient:
  | SmartAccountClient<Transport, Chain, SmartContractAccount<"WebauthnAccount", "0.6.0">>
  | undefined;

export default createConnector<ClientWithAlchemyMethods | SmartAccountClient>(({ emitter }) => ({
  id: "alchemy" as const,
  name: "Alchemy" as const,
  type: "alchemy" as const,
  setup() {
    queryClient.getQueryCache().subscribe(({ query, type }) => {
      if (type !== "updated" || query.queryHash !== JSON.stringify(["credential"]) || !accountClient) return;
      getAccountClient()
        .then((client) =>
          client ? emitter.emit("change", { accounts: [client.account.address] }) : this.onDisconnect(),
        )
        .catch(reportError);
    });
    return Promise.resolve();
  },
  async getAccounts() {
    const client = await getAccountClient();
    return client ? [client.account.address] : [];
  },
  async isAuthorized() {
    const accounts = await this.getAccounts();
    return accounts.length > 0;
  },
  async connect({ chainId, withCapabilities } = {}) {
    if (chainId && chainId !== chain.id) throw new SwitchChainError(new ChainNotConfiguredError());
    let client;
    try {
      client = await getAccountClient();
      if (!client) throw new Error("missing credential");
    } catch (error: unknown) {
      reportError(error);
      throw error;
    }
    return {
      accounts: (withCapabilities
        ? [{ address: client.account.address, capabilities: {} }]
        : [client.account.address]) as never,
      chainId: chain.id,
    };
  },
  disconnect() {
    accountClient = undefined;
    return Promise.resolve();
  },
  switchChain({ chainId }) {
    if (chainId !== chain.id) throw new SwitchChainError(new ChainNotConfiguredError());
    return Promise.resolve(chain);
  },
  onAccountsChanged(accounts) {
    if (accounts.length === 0) this.onDisconnect();
    else emitter.emit("change", { accounts: accounts.map((a) => getAddress(a)) });
  },
  onChainChanged(chainId) {
    if (Number(chainId) !== chain.id) throw new SwitchChainError(new ChainNotConfiguredError());
    emitter.emit("change", { chainId: Number(chainId) });
  },
  onDisconnect(error) {
    emitter.emit("disconnect");
    accountClient = undefined;
    if (error) reportError(error);
  },
  getProvider() {
    return Promise.resolve(accountClient ?? publicClient);
  },
  getChainId: () => Promise.resolve(chain.id),
}));

async function getAccountClient() {
  const credential = queryClient.getQueryData<Credential>(["credential"]);
  if (!credential) return;
  if (accountClient?.account.address !== deriveAddress(credential.factory, credential)) {
    accountClient = await createAccountClient(credential);
  }
  return accountClient;
}
