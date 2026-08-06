import { vi } from "vitest";

import type * as Manteca from "../../utils/ramps/manteca";

vi.mock("../../utils/ramps/manteca", async (importOriginal) => {
  const manteca = await importOriginal<typeof Manteca>();
  const module = { ...manteca };
  return Object.assign(module, {
    default: () => {
      return {
        convertBalanceToUsdc: (userNumberId: string, against: string) =>
          module.convertBalanceToUsdc(userNumberId, against),
        getProvider: (account: Parameters<typeof manteca.getProvider>[0], countryCode?: string) =>
          module.getProvider(account, countryCode),
        getQuote: (coinPair: string) => module.getQuote(coinPair),
        getUser: (account: Parameters<typeof manteca.getUser>[0]) => module.getUser(account),
        onboarding: (account: Parameters<typeof manteca.onboarding>[0], credentialId: string) =>
          module.onboarding(account, credentialId),
        withdrawBalance: (
          userNumberId: string,
          asset: string,
          address: Parameters<typeof manteca.withdrawBalance>[2],
        ) => module.withdrawBalance(userNumberId, asset, address),
      };
    },
  });
});
