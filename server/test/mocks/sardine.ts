import { vi } from "vitest";

import type * as Sardine from "../../utils/sardine";

const customer = vi.fn<typeof Sardine.customer>(() =>
  Promise.resolve({ status: "Success", level: "low", sessionKey: "mock-session-key" }),
);

vi.mock("../../utils/sardine", async (importOriginal) => {
  const sardine = await importOriginal<typeof Sardine>();
  const module = {
    ...sardine,
    customer,
    feedback: (() => Promise.resolve({ status: "Success" })) as typeof sardine.feedback,
    risk: (() =>
      Promise.resolve({
        amlLevel: "low" as const,
        level: "low" as const,
        sessionKey: "mock-session-key",
        status: "Success" as const,
      })) as typeof sardine.risk,
  };
  return Object.assign(module, {
    default: (key: string, url: string) => {
      const client = { key, url };
      return {
        customer: (data: Parameters<typeof sardine.customer>[0], timeout?: number) =>
          timeout === undefined ? module.customer(data) : module.customer(data, timeout),
        feedback: (data: Parameters<typeof sardine.feedback>[0]) => module.feedback(data, client),
        risk: (data: Parameters<typeof sardine.risk>[0]) => module.risk(data, client),
      };
    },
  });
});

export default customer;
