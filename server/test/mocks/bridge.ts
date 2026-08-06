import { vi } from "vitest";

import type * as Bridge from "../../utils/ramps/bridge";

vi.mock("../../utils/ramps/bridge", async (importOriginal) => {
  const bridge = await importOriginal<typeof Bridge>();
  const module = { ...bridge };
  return Object.assign(module, {
    default: () => {
      return {
        createExternalAccount: (
          customer: Parameters<typeof bridge.createExternalAccount>[0],
          account: Parameters<typeof bridge.createExternalAccount>[1],
        ) => module.createExternalAccount(customer, account),
        getCryptoDepositDetails: (
          currency: Parameters<typeof bridge.getCryptoDepositDetails>[0],
          network: Parameters<typeof bridge.getCryptoDepositDetails>[1],
          account: string,
          customer: Parameters<typeof bridge.getCryptoDepositDetails>[3],
        ) => module.getCryptoDepositDetails(currency, network, account, customer),
        getCryptoOfframpDepositDetails: (
          currency: Parameters<typeof bridge.getCryptoOfframpDepositDetails>[0],
          network: Parameters<typeof bridge.getCryptoOfframpDepositDetails>[1],
          address: string,
          account: Parameters<typeof bridge.getCryptoOfframpDepositDetails>[3],
          customer: Parameters<typeof bridge.getCryptoOfframpDepositDetails>[4],
          memo?: string,
        ) => module.getCryptoOfframpDepositDetails(currency, network, address, account, customer, memo),
        getCustomer: (id: string) => module.getCustomer(id),
        getDepositDetails: (
          currency: Parameters<typeof bridge.getDepositDetails>[0],
          account: string,
          customer: Parameters<typeof bridge.getDepositDetails>[2],
        ) => module.getDepositDetails(currency, account, customer),
        getOfframpDepositDetails: (
          externalAccountId: string,
          account: string,
          customer: Parameters<typeof bridge.getOfframpDepositDetails>[2],
          currency: Parameters<typeof bridge.getOfframpDepositDetails>[3],
        ) => module.getOfframpDepositDetails(externalAccountId, account, customer, currency),
        getProvider: (params: Parameters<typeof bridge.getProvider>[0]) => module.getProvider(params),
        getQuote: (from: "USD", to: Parameters<typeof bridge.getQuote>[1]) => module.getQuote(from, to),
        listExternalAccounts: (customerId: string) => module.listExternalAccounts(customerId),
        onboarding: (params: Parameters<typeof bridge.onboarding>[0]) => module.onboarding(params),
        removeExternalAccount: (
          customer: Parameters<typeof bridge.removeExternalAccount>[0],
          externalAccountId: string,
        ) => module.removeExternalAccount(customer, externalAccountId),
        updateExternalAccount: (
          customer: Parameters<typeof bridge.updateExternalAccount>[0],
          externalAccountId: string,
          update: Parameters<typeof bridge.updateExternalAccount>[2],
        ) => module.updateExternalAccount(customer, externalAccountId, update),
      };
    },
  });
});
