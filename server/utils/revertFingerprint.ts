import { BaseError, ContractFunctionRevertedError } from "viem";

import revertReason from "@exactly/common/revertReason";

export default function revertFingerprint(error?: unknown) {
  return [
    "{{ default }}",
    ...(error instanceof BaseError &&
    error.cause instanceof ContractFunctionRevertedError &&
    error.cause.data?.errorName === "WrappedError" &&
    error.cause.data.args
      ? ["WrappedError", String(error.cause.data.args[1])]
      : [revertReason(error, { fallback: "unknown" })]),
  ];
}
