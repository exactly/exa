import { vi } from "vitest";

vi.mock("../../utils/pax", async (importOriginal) => ({
  ...(await importOriginal()),
  addCapita: vi.fn<(data: { internalId: string }) => Promise<Record<string, never>>>().mockResolvedValue({}),
  removeCapita: vi.fn<(internalId: string) => Promise<void>>().mockResolvedValue(),
}));
