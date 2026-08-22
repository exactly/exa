import { vi } from "vitest";

import type * as BridgeModule from "../../utils/ramps/bridge";

type Bridge = ReturnType<typeof BridgeModule.default>;

const mock = vi.hoisted(() => {
  let instance: Bridge | undefined;
  function current() {
    if (!instance) throw new Error("bridge not initialized");
    return instance;
  }
  return {
    set(value: Bridge) {
      instance = value;
    },
    bridge: {
      agreementLink: (...parameters: Parameters<Bridge["agreementLink"]>) => current().agreementLink(...parameters),
      createCustomer: (...parameters: Parameters<Bridge["createCustomer"]>) => current().createCustomer(...parameters),
      createExternalAccount: (...parameters: Parameters<Bridge["createExternalAccount"]>) =>
        current().createExternalAccount(...parameters),
      createLiquidationAddress: (...parameters: Parameters<Bridge["createLiquidationAddress"]>) =>
        current().createLiquidationAddress(...parameters),
      createOfframpTransfer: (...parameters: Parameters<Bridge["createOfframpTransfer"]>) =>
        current().createOfframpTransfer(...parameters),
      createTransfer: (...parameters: Parameters<Bridge["createTransfer"]>) => current().createTransfer(...parameters),
      createVirtualAccount: (...parameters: Parameters<Bridge["createVirtualAccount"]>) =>
        current().createVirtualAccount(...parameters),
      getCryptoDepositDetails: (...parameters: Parameters<Bridge["getCryptoDepositDetails"]>) =>
        current().getCryptoDepositDetails(...parameters),
      getCryptoOfframpDepositDetails: (...parameters: Parameters<Bridge["getCryptoOfframpDepositDetails"]>) =>
        current().getCryptoOfframpDepositDetails(...parameters),
      getCustomer: (...parameters: Parameters<Bridge["getCustomer"]>) => current().getCustomer(...parameters),
      getDepositDetails: (...parameters: Parameters<Bridge["getDepositDetails"]>) =>
        current().getDepositDetails(...parameters),
      getExternalAccount: (...parameters: Parameters<Bridge["getExternalAccount"]>) =>
        current().getExternalAccount(...parameters),
      getKYCLink: (...parameters: Parameters<Bridge["getKYCLink"]>) => current().getKYCLink(...parameters),
      getLiquidationAddresses: (...parameters: Parameters<Bridge["getLiquidationAddresses"]>) =>
        current().getLiquidationAddresses(...parameters),
      getOfframpDepositDetails: (...parameters: Parameters<Bridge["getOfframpDepositDetails"]>) =>
        current().getOfframpDepositDetails(...parameters),
      getProvider: (...parameters: Parameters<Bridge["getProvider"]>) => current().getProvider(...parameters),
      getQuote: (...parameters: Parameters<Bridge["getQuote"]>) => current().getQuote(...parameters),
      getStaticTemplates: (...parameters: Parameters<Bridge["getStaticTemplates"]>) =>
        current().getStaticTemplates(...parameters),
      getTransfers: (...parameters: Parameters<Bridge["getTransfers"]>) => current().getTransfers(...parameters),
      getVirtualAccounts: (...parameters: Parameters<Bridge["getVirtualAccounts"]>) =>
        current().getVirtualAccounts(...parameters),
      listExternalAccounts: (...parameters: Parameters<Bridge["listExternalAccounts"]>) =>
        current().listExternalAccounts(...parameters),
      onboarding: (...parameters: Parameters<Bridge["onboarding"]>) => current().onboarding(...parameters),
      removeExternalAccount: (...parameters: Parameters<Bridge["removeExternalAccount"]>) =>
        current().removeExternalAccount(...parameters),
      updateCustomer: (...parameters: Parameters<Bridge["updateCustomer"]>) => current().updateCustomer(...parameters),
      updateExternalAccount: (...parameters: Parameters<Bridge["updateExternalAccount"]>) =>
        current().updateExternalAccount(...parameters),
    },
  };
});
const { bridge } = mock;

vi.mock("../../utils/ramps/bridge", async (importOriginal) => {
  const module = await importOriginal<typeof BridgeModule>();
  return {
    ...module,
    default: (...parameters: Parameters<typeof module.default>) => {
      mock.set(module.default(...parameters));
      return bridge;
    },
  };
});
