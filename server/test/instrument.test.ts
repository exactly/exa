import { close } from "@sentry/node";
import { DrizzleQueryError } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import config from "../instrument.cjs";

afterAll(() => close());

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("instrument", () => {
  it("titles failed queries by their database cause", () => {
    const cause = new Error('column "salt" does not exist');
    const error = new DrizzleQueryError("select salt from credentials", [], cause);
    const event = {
      exception: {
        values: [
          { type: "error", value: 'column "salt" does not exist' },
          { type: "Error", value: "Failed query: select salt from credentials\nparams: " },
        ],
      },
    };

    const result = config.beforeSend?.(event as never, { originalException: error });

    expect(result).toBe(event);
    expect(event.exception.values).toStrictEqual([
      { type: "error", value: 'column "salt" does not exist' },
      { type: "DrizzleQueryError", value: 'column "salt" does not exist' },
    ]);
  });

  it("keeps failed queries without exceptions", () => {
    const event = { message: "failed" };

    const result = config.beforeSend?.(event as never, {
      originalException: new DrizzleQueryError("select 1", [], new Error("timeout")),
    });

    expect(result).toStrictEqual({ message: "failed" });
  });

  it("keeps failed queries whose cause is not an error", () => {
    const event = { exception: { values: [{ type: "Error", value: "Failed query: select 1" }] } };

    const result = config.beforeSend?.(event as never, { originalException: new DrizzleQueryError("select 1", []) });

    expect(result).toBe(event);
    expect(event.exception.values).toStrictEqual([{ type: "Error", value: "Failed query: select 1" }]);
  });

  it("titles failed queries found through an outer error", () => {
    const cause = new Error('column "salt" does not exist');
    const event = { exception: { values: [{ type: "Error", value: "Failed query: select salt" }] } };

    const result = config.beforeSend?.(event as never, {
      originalException: new Error("wrapper", { cause: new DrizzleQueryError("select salt", [], cause) }),
    });

    expect(result).toBe(event);
    expect(event.exception.values).toStrictEqual([
      { type: "DrizzleQueryError", value: 'column "salt" does not exist' },
    ]);
  });

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
