import { close } from "@sentry/node";
import { DrizzleQueryError } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";

import config from "../instrument.cjs";
import revertFingerprint from "../utils/revertFingerprint";

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
    expect(event).toStrictEqual({
      exception: {
        values: [
          { type: "error", value: 'column "salt" does not exist' },
          { type: "DrizzleQueryError", value: 'column "salt" does not exist' },
        ],
      },
    });
  });

  it("fingerprints failed queries by their database error code", () => {
    const event = { exception: { values: [{ type: "Error", value: "Failed query: select 1" }] } };

    const result = config.beforeSend?.(event as never, {
      originalException: new DrizzleQueryError(
        "select 1",
        [],
        Object.assign(new Error("deadlock detected"), { code: "40P01" }),
      ),
    });

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      exception: { values: [{ type: "DrizzleQueryError", value: "deadlock detected" }] },
      fingerprint: ["{{ default }}", "40P01"],
    });
  });

  it.each(["connect ECONNREFUSED 10.0.0.1:5432", "connect ECONNREFUSED 10.0.0.2:5433"])(
    "fingerprints failed queries by their code regardless of message (%s)",
    (message) => {
      const event = { exception: { values: [{ type: "Error", value: "Failed query: select 1" }] } };

      config.beforeSend?.(event as never, {
        originalException: new DrizzleQueryError(
          "select 1",
          [],
          Object.assign(new Error(message), { code: "ECONNREFUSED" }),
        ),
      });

      expect(event).toStrictEqual({
        exception: { values: [{ type: "DrizzleQueryError", value: message }] },
        fingerprint: ["{{ default }}", "ECONNREFUSED"],
      });
    },
  );

  it("keeps the fingerprint of failed queries reported with one", () => {
    const event = {
      exception: { values: [{ type: "Error", value: "Failed query: select 1" }] },
      fingerprint: ["{{ default }}", "bad collection"],
    };

    const result = config.beforeSend?.(event as never, {
      originalException: new DrizzleQueryError("select 1", [], Object.assign(new Error("timeout"), { code: "57014" })),
    });

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      exception: { values: [{ type: "DrizzleQueryError", value: "timeout" }] },
      fingerprint: ["{{ default }}", "bad collection"],
    });
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
    expect(event).toStrictEqual({ exception: { values: [{ type: "Error", value: "Failed query: select 1" }] } });
  });

  it("titles failed queries found through an outer error", () => {
    const cause = new Error('column "salt" does not exist');
    const event = { exception: { values: [{ type: "Error", value: "Failed query: select salt" }] } };

    const result = config.beforeSend?.(event as never, {
      originalException: new Error("wrapper", { cause: new DrizzleQueryError("select salt", [], cause) }),
    });

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      exception: { values: [{ type: "DrizzleQueryError", value: 'column "salt" does not exist' }] },
    });
  });

  it.each([
    "Secret [projects/1/secrets/sandbox-poke-onesignal-apps] not found or has no versions.",
    "Secret [projects/1/secrets/sandbox-refund-onesignal-apps] not found or has no versions.",
  ])("fingerprints missing grpc resources by their details (%s)", (details) => {
    const event = { exception: { values: [{ type: "Error", value: `5 NOT_FOUND: ${details}` }] } };

    const result = config.beforeSend?.(event as never, { originalException: grpcError(5, details) });

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: `5 NOT_FOUND: ${details}` }] },
      fingerprint: ["{{ default }}", "5", details],
    });
  });

  it.each([
    [7, "PERMISSION_DENIED", "Permission 'secretmanager.versions.access' denied for resource 'sandbox-redis-url'"],
    [
      9,
      "FAILED_PRECONDITION",
      "Secret Version [projects/1/secrets/sandbox-redis-url/versions/2] is in DISABLED state.",
    ],
    [
      9,
      "FAILED_PRECONDITION",
      "Secret Version [projects/1/secrets/sandbox-panda-api-key/versions/3] is in DISABLED state.",
    ],
  ])("fingerprints unusable grpc resources by their details (%i %s: %s)", (code, name, details) => {
    const event = { exception: { values: [{ type: "Error", value: `${code} ${name}: ${details}` }] } };

    config.beforeSend?.(event as never, { originalException: grpcError(code, details) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: `${code} ${name}: ${details}` }] },
      fingerprint: ["{{ default }}", String(code), details],
    });
  });

  it.each([
    "Deadline exceeded after 60.000s,name resolution: 0.008s,metadata filters: 0.001s,Waiting for LB pick",
    "Deadline exceeded after 59.999s,name resolution: 0.007s,metadata filters: 0.002s,Waiting for LB pick",
  ])("fingerprints other grpc failures by their code regardless of details (%s)", (details) => {
    const event = { exception: { values: [{ type: "Error", value: `4 DEADLINE_EXCEEDED: ${details}` }] } };

    config.beforeSend?.(event as never, { originalException: grpcError(4, details) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: `4 DEADLINE_EXCEEDED: ${details}` }] },
      fingerprint: ["{{ default }}", "4"],
    });
  });

  it("fingerprints grpc failures found through an outer error", () => {
    const details = "Secret [projects/1/secrets/sandbox-redis-url] not found or has no versions.";
    const event = { exception: { values: [{ type: "Error", value: "wrapper" }] } };

    config.beforeSend?.(event as never, {
      originalException: new Error("wrapper", { cause: grpcError(5, details) }),
    });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: "wrapper" }] },
      fingerprint: ["{{ default }}", "5", details],
    });
  });

  it("keeps the fingerprint of grpc failures reported with one", () => {
    const event = {
      exception: { values: [{ type: "Error", value: "5 NOT_FOUND: missing" }] },
      fingerprint: ["{{ default }}", "known"],
    };

    config.beforeSend?.(event as never, { originalException: grpcError(5, "missing") });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: "5 NOT_FOUND: missing" }] },
      fingerprint: ["{{ default }}", "known"],
    });
  });

  it("fingerprints grpc failures reported with an unknown revert fingerprint", () => {
    const details = "Deadline exceeded after 60.000s";
    const event = {
      exception: { values: [{ type: "Error", value: `4 DEADLINE_EXCEEDED: ${details}` }] },
      fingerprint: ["{{ default }}", "unknown"],
    };

    config.beforeSend?.(event as never, { originalException: grpcError(4, details) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: `4 DEADLINE_EXCEEDED: ${details}` }] },
      fingerprint: ["{{ default }}", "4"],
    });
  });

  it("replaces a trailing unknown revert reason of grpc failures", () => {
    const details = "Secret [projects/1/secrets/sandbox-redis-url] not found or has no versions.";
    const event = {
      exception: { values: [{ type: "Error", value: `5 NOT_FOUND: ${details}` }] },
      fingerprint: ["{{ default }}", "refund.exhausted", "unknown"],
    };

    config.beforeSend?.(event as never, { originalException: grpcError(5, details) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: `5 NOT_FOUND: ${details}` }] },
      fingerprint: ["{{ default }}", "refund.exhausted", "5", details],
    });
  });

  it.each([
    ["google.cloud.secretmanager.v1.SecretManagerService", "14 UNAVAILABLE: No connection established", ["14"]],
    ["google.cloud.secretmanager.v1.SecretManagerService", "8 RESOURCE_EXHAUSTED: Quota exceeded", ["8"]],
    ["google.cloud.kms.v1.KeyManagementService", "14 UNAVAILABLE: No connection established", ["14"]],
  ])("fingerprints exhausted client retries by their api and retried code (%s, %s)", (api, retried, parts) => {
    const message = `Total timeout of API ${api} exceeded 600000 milliseconds retrying error Error: ${retried} before any response was received.`;
    const event = { exception: { values: [{ type: "Error", value: message }] } };

    config.beforeSend?.(event as never, { originalException: gaxError(message) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: message }] },
      fingerprint: ["{{ default }}", "4", api, ...parts],
    });
  });

  it("fingerprints exhausted client retries without a retried error by their api", () => {
    const message =
      "Total timeout of API google.cloud.kms.v1.KeyManagementService exceeded 600000 milliseconds before any response was received.";
    const event = { exception: { values: [{ type: "Error", value: message }] } };

    config.beforeSend?.(event as never, { originalException: gaxError(message) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: message }] },
      fingerprint: ["{{ default }}", "4", "google.cloud.kms.v1.KeyManagementService"],
    });
  });

  it("fingerprints exhausted client retries without an api by their retried code", () => {
    const message =
      "Exceeded maximum number of retries retrying error Error: 14 UNAVAILABLE before any response was received";
    const event = { exception: { values: [{ type: "Error", value: message }] } };

    config.beforeSend?.(event as never, { originalException: gaxError(message) });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: message }] },
      fingerprint: ["{{ default }}", "4", "14"],
    });
  });

  it("fingerprints grpc failures reported with their revert fingerprint", () => {
    const error = grpcError(4, "Deadline exceeded after 60.000s");
    const event = {
      exception: { values: [{ type: "Error", value: "4 DEADLINE_EXCEEDED" }] },
      fingerprint: revertFingerprint(error),
    };

    config.beforeSend?.(event as never, { originalException: error });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: "4 DEADLINE_EXCEEDED" }] },
      fingerprint: ["{{ default }}", "4"],
    });
  });

  it("fingerprints grpc resource failures without details by their code", () => {
    const event = { exception: { values: [{ type: "Error", value: "5 NOT_FOUND" }] } };

    config.beforeSend?.(event as never, {
      originalException: Object.assign(new Error("5 NOT_FOUND"), { code: 5, metadata: {} }),
    });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: "5 NOT_FOUND" }] },
      fingerprint: ["{{ default }}", "5"],
    });
  });

  it("keeps fingerprints of grpc failures ending in a known reason", () => {
    const event = {
      exception: { values: [{ type: "Error", value: "5 NOT_FOUND: missing" }] },
      fingerprint: ["{{ default }}", "unknown", "known"],
    };

    config.beforeSend?.(event as never, { originalException: grpcError(5, "missing") });

    expect(event).toStrictEqual({
      exception: { values: [{ type: "Error", value: "5 NOT_FOUND: missing" }] },
      fingerprint: ["{{ default }}", "unknown", "known"],
    });
  });

  it.each([
    ["string code", Object.assign(new Error("boom"), { code: "5", details: "missing", metadata: {} })],
    ["no metadata", Object.assign(new Error("boom"), { code: 5, details: "missing" })],
  ])("keeps errors that are not grpc failures (%s)", (_, error) => {
    const event = { exception: { values: [{ type: "Error", value: "boom" }] } };

    const result = config.beforeSend?.(event as never, { originalException: error });

    expect(result).toBe(event);
    expect(event).toStrictEqual({ exception: { values: [{ type: "Error", value: "boom" }] } });
  });

  it("moves synthetic message stacks to threads", () => {
    const stacktrace = { frames: [{ filename: "hooks/panda.ts", lineno: 546 }] };
    const event = {
      level: "warning",
      message: "unknown panda decline reason",
      exception: {
        values: [
          { value: "unknown panda decline reason", stacktrace, mechanism: { type: "generic", synthetic: true } },
        ],
      },
    };

    const result = config.beforeSend?.(event as never, {});

    expect(result).toStrictEqual({
      level: "warning",
      message: "unknown panda decline reason",
      exception: undefined,
      threads: { values: [{ stacktrace, crashed: false, current: true }] },
    });
  });

  it("keeps synthetic message exceptions without stacks", () => {
    const event = {
      message: "failed",
      exception: { values: [{ value: "failed", mechanism: { type: "generic", synthetic: true } }] },
    };

    const result = config.beforeSend?.(event as never, {});

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      message: "failed",
      exception: { values: [{ value: "failed", mechanism: { type: "generic", synthetic: true } }] },
    });
  });

  it("keeps message events with real exceptions", () => {
    const event = {
      message: "failed",
      exception: { values: [{ type: "Error", value: "boom", mechanism: { type: "generic", handled: true } }] },
    };

    const result = config.beforeSend?.(event as never, {});

    expect(result).toBe(event);
    expect(event).toStrictEqual({
      message: "failed",
      exception: { values: [{ type: "Error", value: "boom", mechanism: { type: "generic", handled: true } }] },
    });
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

function grpcError(code: number, details: string) {
  return Object.assign(new Error(`${code} ${details}`), { code, details, metadata: {} });
}

function gaxError(message: string) {
  return Object.assign(new Error(message), { code: 4, metadata: undefined, statusDetails: undefined });
}
