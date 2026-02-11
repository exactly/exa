import { BaseError, ContractFunctionRevertedError } from "viem";
import { describe, expect, it } from "vitest";

import fingerprintRevert from "../../utils/fingerprintRevert";

describe("fingerprintRevert", () => {
  it("returns unknown for non-BaseError", () => {
    expect(fingerprintRevert(new Error("plain"))).toEqual(["{{ default }}", "unknown"]);
  });

  it("returns unknown for non-error values", () => {
    expect(fingerprintRevert("string")).toEqual(["{{ default }}", "unknown"]);
    expect(fingerprintRevert(null)).toEqual(["{{ default }}", "unknown"]);
    expect(fingerprintRevert()).toEqual(["{{ default }}", "unknown"]);
    expect(fingerprintRevert(42)).toEqual(["{{ default }}", "unknown"]);
  });

  it("returns unknown for BaseError without ContractFunctionRevertedError cause", () => {
    expect(fingerprintRevert(new BaseError("test", { cause: new Error("other") }))).toEqual([
      "{{ default }}",
      "unknown",
    ]);
  });

  it("returns error name when available", () => {
    expect(
      fingerprintRevert(revertError({ errorName: "InsufficientBalance", abiItem: {} as never, args: [] })),
    ).toEqual(["{{ default }}", "InsufficientBalance"]);
  });

  it("falls back to reason", () => {
    expect(fingerprintRevert(revertError(undefined, { reason: "some reason" }))).toEqual([
      "{{ default }}",
      "some reason",
    ]);
  });

  it("falls back to signature", () => {
    expect(fingerprintRevert(revertError(undefined, { signature: "0xdeadbeef" }))).toEqual([
      "{{ default }}",
      "0xdeadbeef",
    ]);
  });

  it("returns unknown for empty revert", () => {
    expect(fingerprintRevert(revertError())).toEqual(["{{ default }}", "unknown"]);
  });

  it("handles WrappedError with selector", () => {
    expect(
      fingerprintRevert(
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
      fingerprintRevert(revertError({ errorName: "WrappedError", abiItem: {} as never, args: undefined as never })),
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
