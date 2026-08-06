import { vi } from "vitest";

import type * as Manteca from "../../utils/ramps/manteca";

vi.mock("../../utils/ramps/manteca", async (importOriginal) => {
  const manteca = await importOriginal<typeof Manteca>();
  const module = { ...manteca };
  return Object.assign(module, {
    default: (key: string, url: string) => {
      const provider = { key, url };
      return {
        convertBalanceToUsdc: (userNumberId: string, against: string) =>
          module.convertBalanceToUsdc(userNumberId, against, provider),
        withdrawBalance: (
          userNumberId: string,
          asset: string,
          address: Parameters<typeof manteca.withdrawBalance>[2],
        ) => module.withdrawBalance(userNumberId, asset, address, provider),
      };
    },
  });
});
