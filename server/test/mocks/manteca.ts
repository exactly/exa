import { vi } from "vitest";

import type * as MantecaModule from "../../utils/ramps/manteca";

type Manteca = ReturnType<typeof MantecaModule.default>;

const mock = vi.hoisted(() => {
  let instance: Manteca | undefined;
  function current() {
    if (!instance) throw new Error("manteca not initialized");
    return instance;
  }
  return {
    set(value: Manteca) {
      instance = value;
    },
    manteca: {
      acceptTermsAndConditions: (...parameters: Parameters<Manteca["acceptTermsAndConditions"]>) =>
        current().acceptTermsAndConditions(...parameters),
      balances: (...parameters: Parameters<Manteca["balances"]>) => current().balances(...parameters),
      convertBalanceToUsdc: (...parameters: Parameters<Manteca["convertBalanceToUsdc"]>) =>
        current().convertBalanceToUsdc(...parameters),
      createOrder: (...parameters: Parameters<Manteca["createOrder"]>) => current().createOrder(...parameters),
      getDepositDetails: (...parameters: Parameters<Manteca["getDepositDetails"]>) =>
        current().getDepositDetails(...parameters),
      getLimits: (...parameters: Parameters<Manteca["getLimits"]>) => current().getLimits(...parameters),
      getProvider: (...parameters: Parameters<Manteca["getProvider"]>) => current().getProvider(...parameters),
      getQuote: (...parameters: Parameters<Manteca["getQuote"]>) => current().getQuote(...parameters),
      getUser: (...parameters: Parameters<Manteca["getUser"]>) => current().getUser(...parameters),
      initiateOnboarding: (...parameters: Parameters<Manteca["initiateOnboarding"]>) =>
        current().initiateOnboarding(...parameters),
      lockQrPayment: (...parameters: Parameters<Manteca["lockQrPayment"]>) => current().lockQrPayment(...parameters),
      onboarding: (...parameters: Parameters<Manteca["onboarding"]>) => current().onboarding(...parameters),
      uploadIdentityFile: (...parameters: Parameters<Manteca["uploadIdentityFile"]>) =>
        current().uploadIdentityFile(...parameters),
      withdrawBalance: (...parameters: Parameters<Manteca["withdrawBalance"]>) =>
        current().withdrawBalance(...parameters),
      withdrawOrder: (...parameters: Parameters<Manteca["withdrawOrder"]>) => current().withdrawOrder(...parameters),
    },
  };
});
const { manteca } = mock;

vi.mock("../../utils/ramps/manteca", async (importOriginal) => {
  const module = await importOriginal<typeof MantecaModule>();
  return {
    ...module,
    default: (...parameters: Parameters<typeof module.default>) => {
      mock.set(module.default(...parameters));
      return manteca;
    },
  };
});
