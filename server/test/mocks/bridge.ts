import { vi } from "vitest";

import type * as Bridge from "../../utils/ramps/bridge";

vi.mock("../../utils/ramps/bridge", async (importOriginal) => {
  const bridge = await importOriginal<typeof Bridge>();
  const module = { ...bridge };
  return Object.assign(module, {
    default: (key: string, url: string) => ({
      getCustomer: (id: string) => module.getCustomer(id, { key, url }),
    }),
  });
});
