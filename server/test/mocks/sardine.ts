import { vi } from "vitest";

const customer = vi.fn(() => Promise.resolve({ status: "Success", level: "low", sessionKey: "mock-session-key" }));

vi.mock("../../utils/sardine", async (importOriginal) => ({
  ...(await importOriginal()),
  customer,
  feedback: vi.fn(() => Promise.resolve({ status: "Success" })),
  default: vi.fn(() => Promise.resolve({ amlLevel: "low", level: "low", sessionKey: "mock-session-key", status: "Success" })),
}));

export default customer;
