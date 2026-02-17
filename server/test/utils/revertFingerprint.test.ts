import { BaseError, ContractFunctionRevertedError } from "viem";
import { describe, expect, it } from "vitest";

import revertFingerprint from "../../utils/revertFingerprint";

describe("revertFingerprint", () => {
  it("returns unknown for non-BaseError", () => {
    expect(revertFingerprint(new Error("plain"))).toEqual(["{{ default }}", "unknown"]);
  });

  it("returns unknown for non-error values", () => {
    expect(revertFingerprint("string")).toEqual(["{{ default }}", "unknown"]);
    expect(revertFingerprint(null)).toEqual(["{{ default }}", "unknown"]);
    expect(revertFingerprint()).toEqual(["{{ default }}", "unknown"]);
    expect(revertFingerprint(42)).toEqual(["{{ default }}", "unknown"]);
  });

  it("returns unknown for BaseError without ContractFunctionRevertedError cause", () => {
    expect(revertFingerprint(new BaseError("test", { cause: new Error("other") }))).toEqual([
      "{{ default }}",
      "unknown",
    ]);
  });

  it("returns error name when available", () => {
    expect(
      revertFingerprint(revertError({ errorName: "InsufficientBalance", abiItem: {} as never, args: [] })),
    ).toEqual(["{{ default }}", "InsufficientBalance"]);
  });

  it("falls back to reason", () => {
    expect(revertFingerprint(revertError(undefined, { reason: "some reason" }))).toEqual([
      "{{ default }}",
      "some reason",
    ]);
  });

  it("falls back to signature", () => {
    expect(revertFingerprint(revertError(undefined, { signature: "0xdeadbeef" }))).toEqual([
      "{{ default }}",
      "0xdeadbeef",
    ]);
  });

  it("returns unknown for empty revert", () => {
    expect(revertFingerprint(revertError())).toEqual(["{{ default }}", "unknown"]);
  });

  it("handles WrappedError with selector", () => {
    expect(
      revertFingerprint(
        revertError({
          errorName: "WrappedError",
          abiItem: {} as never,
          args: ["0x1234567890123456789012345678901234567890", "0xdeadbeef", "0x", "0x"],
        }),
      ),
    ).toEqual(["{{ default }}", "WrappedError", "0xdeadbeef"]);
  });

  it("treats WrappedError without args as regular named error", () => {
    expect(
      revertFingerprint(revertError({ errorName: "WrappedError", abiItem: {} as never, args: undefined as never })),
    ).toEqual(["{{ default }}", "WrappedError"]);
  });
});

function revertError(
  data?: ContractFunctionRevertedError["data"],
  overrides?: { reason?: string; signature?: string },
) {
  const cause = new ContractFunctionRevertedError({ abi: [], functionName: "test" });
  cause.data = data;
  if (overrides?.reason !== undefined) Object.defineProperty(cause, "reason", { value: overrides.reason });
  if (overrides?.signature !== undefined) Object.defineProperty(cause, "signature", { value: overrides.signature });
  return new BaseError("test", { cause });
}
