import { BaseError, ContractFunctionRevertedError } from "viem";

type Fallback = "message" | "name" | "string" | "unknown";

export default function revertReason(
  error?: unknown,
  { fallback = "name", withArguments = false }: { fallback?: Fallback; withArguments?: boolean } = {},
): string {
  return error instanceof BaseError && error.cause instanceof ContractFunctionRevertedError
    ? withArguments && error.cause.data?.errorName
      ? `${error.cause.data.errorName}(${error.cause.data.args?.map(String).join(",") ?? ""})`
      : (error.cause.data?.errorName ?? error.cause.reason ?? error.cause.signature ?? "unknown")
    : fallback === "message"
      ? error instanceof Error
        ? error.message
        : String(error)
      : fallback === "string"
        ? String(error)
        : fallback === "unknown"
          ? "unknown"
          : error instanceof Error
            ? error.name
            : "unknown";
}
