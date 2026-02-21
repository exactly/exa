import { BaseError, ContractFunctionRevertedError } from "viem";

import revertReason from "@exactly/common/revertReason";

export default function revertFingerprint(error?: unknown) {
  const cause = error instanceof BaseError ? error.walk((r) => r instanceof ContractFunctionRevertedError) : undefined;
  return [
    "{{ default }}",
    ...(cause instanceof ContractFunctionRevertedError && cause.data?.errorName === "WrappedError" && cause.data.args
      ? ["WrappedError", String(cause.data.args[1])]
      : [revertReason(error, { fallback: "unknown" })]),
  ];
}
