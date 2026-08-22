import { close } from "@sentry/node";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import config from "../instrument.cjs";

afterAll(() => close());

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrument", () => {
  it("adds the cloud run service to transaction names", () => {
    vi.stubEnv("K_SERVICE", "sandbox-chat");
    const transaction = { transaction: "POST /" };

    const result = config.beforeSendTransaction?.(transaction as never, {} as never);

    expect(result).toBe(transaction);
    expect(transaction.transaction).toBe("POST / · sandbox-chat");
  });

  it("keeps transaction names outside cloud run", () => {
    vi.stubEnv("K_SERVICE", "");
    const transaction = { transaction: "POST /" };

    const result = config.beforeSendTransaction?.(transaction as never, {} as never);

    expect(result).toBe(transaction);
    expect(transaction.transaction).toBe("POST /");
  });

  it("drops ignored transactions", () => {
    vi.stubEnv("K_SERVICE", "sandbox-chat");
    const transaction = { extra: { "exa.ignore": true }, transaction: "POST /" };

    const result = config.beforeSendTransaction?.(transaction as never, {} as never);

    expect(result).toBeNull();
    expect(transaction.transaction).toBe("POST /");
  });
});
