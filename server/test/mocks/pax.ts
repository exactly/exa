import { vi } from "vitest";

vi.mock("../../utils/pax", async (importOriginal) => ({
  ...(await importOriginal()),
  addCapita: vi.fn<() => Promise<Record<string, never>>>().mockResolvedValue({}),
  removeCapita: vi.fn<() => Promise<void>>().mockResolvedValue(),
}));
