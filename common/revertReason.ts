import { BaseError, ContractFunctionRevertedError } from "viem";

type Fallback = "message" | "name" | "string" | "unknown";

export default function revertReason(
  error?: unknown,
  { fallback = "name", withArguments = false }: { fallback?: Fallback; withArguments?: boolean } = {},
): string {
  const cause = error instanceof BaseError ? error.walk((r) => r instanceof ContractFunctionRevertedError) : undefined;
  return cause instanceof ContractFunctionRevertedError
    ? withArguments && cause.data?.errorName
      ? `${cause.data.errorName}(${cause.data.args?.map(String).join(",") ?? ""})`
      : (cause.data?.errorName ?? cause.reason ?? cause.signature ?? "unknown")
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
