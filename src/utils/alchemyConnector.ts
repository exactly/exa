import { getAddress, SwitchChainError, type Chain, type Transport } from "viem";
import { ChainNotConfiguredError, createConnector } from "wagmi";

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
  async getAccounts() {
    const credential = queryClient.getQueryData<Credential>(["credential"]);
    if (!credential) return [];
    accountClient ??= await createAccountClient(credential);
    return [accountClient.account.address];
  },
  async isAuthorized() {
    const accounts = await this.getAccounts();
    return accounts.length > 0;
  },
  async connect({ chainId, withCapabilities } = {}) {
    if (chainId && chainId !== chain.id) throw new SwitchChainError(new ChainNotConfiguredError());
    try {
      const credential = queryClient.getQueryData<Credential>(["credential"]);
      if (!credential) throw new Error("missing credential");
      accountClient ??= await createAccountClient(credential);
    } catch (error: unknown) {
      reportError(error);
      throw error;
    }
    return {
      accounts: (withCapabilities
        ? [{ address: accountClient.account.address, capabilities: {} }]
        : [accountClient.account.address]) as never,
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
  getProvider({ chainId } = {}) {
    if (chainId && chainId !== chain.id) throw new SwitchChainError(new ChainNotConfiguredError());
    return Promise.resolve(accountClient ?? publicClient);
  },
  getChainId: () => Promise.resolve(chain.id),
}));
