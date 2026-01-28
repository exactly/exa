import { vi } from "vitest";

import type { CapitaRequest } from "../../utils/pax";
import type { InferInput } from "valibot";

vi.mock("../../utils/pax", async (importOriginal) => ({
  ...(await importOriginal()),
  addCapita: vi
    .fn<(data: InferInput<typeof CapitaRequest> & { internalId: string }) => Promise<Record<string, never>>>()
    .mockResolvedValue({}),
  removeCapita: vi.fn<(internalId: string) => Promise<void>>().mockResolvedValue(),
}));
