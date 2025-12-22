import { vi } from "vitest";

vi.mock("../../utils/sardine", async (importOriginal) => ({
  ...(await importOriginal()),
  customer: () => Promise.resolve({ status: "Success", level: "low", sessionKey: "mock-session-key" }),
  feedback: () => Promise.resolve({ status: "Success" }),
  default: () => Promise.resolve({ amlLevel: "low", level: "low", sessionKey: "mock-session-key", status: "Success" }),
}));
