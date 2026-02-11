import { BaseError, ContractFunctionRevertedError } from "viem";

export default function fingerprintRevert(error?: unknown) {
  return [
    "{{ default }}",
    ...(error instanceof BaseError && error.cause instanceof ContractFunctionRevertedError
      ? error.cause.data?.errorName === "WrappedError" && error.cause.data.args
        ? ["WrappedError", String(error.cause.data.args[1])]
        : [error.cause.data?.errorName ?? error.cause.reason ?? error.cause.signature ?? "unknown"]
      : ["unknown"]),
  ];
}
