import {
  BaseError,
  ContractFunctionRevertedError,
  ExecutionRevertedError,
  HttpRequestError,
  RpcError,
  RpcRequestError,
  TimeoutError,
} from "viem";

import stableMessage from "./stableMessage";

export default function rpcFingerprint(error: unknown) {
  if (!(error instanceof BaseError)) return;
  const reverted = error.walk(
    (cause) =>
      cause instanceof ExecutionRevertedError ||
      (cause instanceof ContractFunctionRevertedError && cause.raw !== undefined),
  );
  if (reverted) return;
  const transport = error.walk(
    (cause) =>
      cause instanceof RpcError ||
      cause instanceof RpcRequestError ||
      cause instanceof HttpRequestError ||
      cause instanceof TimeoutError,
  );
  if (!(transport instanceof BaseError)) return;
  if (transport instanceof HttpRequestError) {
    return [
      transport.name,
      transport.shortMessage,
      ...(transport.status === undefined ? [] : [String(transport.status)]),
    ];
  }
  const request = transport.walk((cause) => cause instanceof RpcRequestError);
  const details = request instanceof RpcRequestError ? request.details : transport.details;
  return [
    transport.name,
    transport.shortMessage,
    ...(details ? [stableMessage(details).replaceAll(/(^|[^A-Z\d])\d+/g, (_, prefix: string) => `${prefix}0`)] : []),
  ];
}
