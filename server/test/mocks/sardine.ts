import { vi } from "vitest";

import type createSardine from "../../utils/sardine";

type Sardine = ReturnType<typeof createSardine>;

export const customer = vi.fn<Sardine["customer"]>(() =>
  Promise.resolve({ status: "Success", level: "low", sessionKey: "mock-session-key" }),
);
export const feedback = vi.fn<Sardine["feedback"]>(() => Promise.resolve({ status: "Success" }));
export const risk = vi.fn<Sardine["risk"]>(() =>
  Promise.resolve({
    amlLevel: "low",
    level: "low",
    sessionKey: "mock-session-key",
    status: "Success",
  }),
);

vi.mock("../../utils/sardine", async (importOriginal) => {
  const actual = await importOriginal<{ default: typeof createSardine }>();
  return { ...actual, default: () => ({ customer, feedback, risk }) };
});

export default customer;
