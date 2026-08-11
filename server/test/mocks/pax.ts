import { vi } from "vitest";

import type createPax from "../../utils/pax";

type Pax = ReturnType<typeof createPax>;

export const addCapita = vi.fn<Pax["addCapita"]>().mockResolvedValue({});
export const removeCapita = vi.fn<Pax["removeCapita"]>().mockResolvedValue();
let instance: Pax;

export function deriveAssociateId(...args: Parameters<Pax["deriveAssociateId"]>) {
  return instance.deriveAssociateId(...args);
}

vi.mock("../../utils/pax", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof createPax }>();
  return {
    ...actual,
    default: (...args: Parameters<typeof createPax>) => {
      instance = actual.default(...args);
      return { ...instance, addCapita, removeCapita };
    },
  };
});
