import { vi } from "vitest";

import type * as Pax from "../../utils/pax";

vi.mock("../../utils/pax", async (importOriginal) => {
  const pax = await importOriginal<typeof Pax>();
  const module = {
    ...pax,
    addCapita: vi.fn<typeof pax.addCapita>().mockResolvedValue({}),
    removeCapita: vi.fn<(internalId: string) => Promise<void>>().mockResolvedValue(),
  };
  return Object.assign(module, {
    default: (options: Parameters<typeof pax.default>[0]) => ({
      addCapita: (data: Parameters<typeof pax.addCapita>[0]) => module.addCapita(data, options),
      deriveAssociateId: (account: Parameters<typeof pax.deriveAssociateId>[0]) =>
        module.deriveAssociateId(account, options.associateKey),
    }),
  });
});
