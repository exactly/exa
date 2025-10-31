import { vi } from "vitest";

vi.mock("../../utils/sardine", async (importOriginal) => ({
  ...(await importOriginal()),
  customer: () => Promise.resolve({ status: "success", level: "low" }),
  feedback: () => Promise.resolve({}),
  default: () => Promise.resolve({ status: "success", level: "low" }),
}));
