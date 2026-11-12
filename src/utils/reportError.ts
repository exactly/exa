import { captureException, withScope } from "@sentry/react-native";
import { BaseError, ContractFunctionRevertedError, HttpRequestError, RpcRequestError, TimeoutError } from "viem";

import revertReason from "@exactly/common/revertReason";
import rpcFingerprint from "@exactly/common/rpcFingerprint";
import stableMessage from "@exactly/common/stableMessage";

export default function reportError(error: unknown, hint?: Parameters<typeof captureException>[1]) {
  const parsed = parseError(error);
  const classification = classify(parsed);
  if (!classification.knownWarning) console.error(error); // eslint-disable-line no-console
  try {
    const value = classification.fingerprint;
    const level =
      hint && typeof hint === "object" && "level" in hint && typeof hint.level === "string" ? hint.level : undefined;
    const warning = classification.knownWarning || level === "warning";
    const info = classification.knownInfo || level === "info";
    const title =
      (value?.[0] !== undefined && value[0] !== "{{ default }}" ? value[0] : value?.[1]) ??
      (parsed.name && parsed.name !== "Error" && parsed.name !== "APIError" ? parsed.name : undefined) ??
      parsed.status ??
      parsed.message;
    if (!warning && !info && value === undefined) {
      captureException(error, hint);
      return classification;
    }
    withScope((scope) => {
      if (warning) scope.setLevel("warning");
      else if (info) scope.setLevel("info");
      if (value !== undefined) scope.setFingerprint(value);
      else if (warning || info) scope.setFingerprint(["{{ default }}", title ?? "unknown"]);
      const { endpoint } = parsed;
      if (endpoint !== undefined) {
        scope.setTag("endpoint", endpoint);
        if (parsed.name === "APIError") {
          scope.addEventProcessor((event) => {
            const current = event.exception?.values?.[0];
            if (current) current.value = `${current.value?.trim()} (${endpoint})`;
            return event;
          });
        }
      }
      if ((warning || info) && title) {
        scope.addEventProcessor((event) => {
          const current = event.exception?.values?.[0];
          if (current && (current.type === undefined || current.type === "Error" || current.type === "APIError")) {
            current.type = title;
          }
          return event;
        });
      }
      captureException(error, hint);
    });
  } catch (sentryError) {
    console.error(sentryError); // eslint-disable-line no-console
  }
  return classification;
}

const passkeyCancelledCodes = new Set(["ERR_USER_CANCELLED", "ERR_PASSKEY_REQUEST_FAILED"]);
const passkeyCancelledPatterns = [
  /com\.apple\.AuthenticationServices\.AuthorizationError\D+\b1001\b/i,
  /com\.apple\.AuthenticationServices\.AuthorizationError\D+\b1004\b/i,
  /^UserCancelled$/,
];
const passkeyKnownCodes = new Set([...passkeyCancelledCodes, "ERR_PENDING_PASSKEY_REQUEST"]);
const passkeyKnownPatterns = [
  ...passkeyCancelledPatterns,
  /com\.apple\.AuthenticationServices\.AuthorizationError/i,
  /Biometrics must be enabled/,
  /Device must be unlocked/,
  /There is already a pending passkey request/,
];
const authPrefixes = ["androidx.credentials.exceptions.domerrors.NotAllowedError"];
const networkTypes = [
  ["ConnectionLost", /network connection was lost/i],
  ["Offline", /internet connection appears to be offline/i],
  ["RequestFailed", /^Network request failed$/],
  ["TLSFailure", /tls error caused the secure connection to fail/i],
  ["Timeout", /request timed out|request took too long to respond/i],
] as const;
type ParsedError = ReturnType<typeof parseError>;

export function classifyError(error: unknown) {
  return classify(parseError(error));
}

function parseError(error: unknown) {
  const root = walkCause(error);
  const code =
    typeof root === "object" && root !== null && "code" in root && typeof root.code === "string" && root.code.length > 0
      ? root.code
      : undefined;
  let status: string | undefined;
  let route: string | undefined;
  for (
    let cause: unknown = error;
    cause != null && typeof cause === "object" && (status === undefined || route === undefined);
    cause = (cause as { cause?: unknown }).cause
  ) {
    if (status === undefined && "code" in cause && typeof cause.code === "number" && Number.isFinite(cause.code)) {
      status = String(cause.code);
    }
    if (route === undefined && "endpoint" in cause && typeof cause.endpoint === "string") route = cause.endpoint;
  }
  const name =
    typeof root === "object" && root !== null && "name" in root && typeof root.name === "string" && root.name.length > 0
      ? root.name
      : undefined;
  const raw =
    root instanceof Error
      ? normalizeMessage(root.message)
      : typeof root === "string"
        ? normalizeMessage(root)
        : typeof root === "object" &&
            root !== null &&
            "message" in root &&
            typeof root.message === "string" &&
            root.message.length > 0
          ? normalizeMessage(root.message)
          : undefined;
  const fetchFailure = raw?.match(
    /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.) \(([^)]+)\)$/,
  );
  const message = fetchFailure?.[1] ?? raw;
  const rpc = rpcFingerprint(error);
  const revert =
    rpc === undefined &&
    error instanceof BaseError &&
    error.walk((r) => r instanceof ContractFunctionRevertedError) !== null;
  const reason = revertReason(error, { fallback: "unknown" });
  const request =
    error instanceof BaseError
      ? error.walk(
          (cause) =>
            cause instanceof HttpRequestError || cause instanceof RpcRequestError || cause instanceof TimeoutError,
        )
      : null;
  const endpoint =
    route ??
    (request instanceof HttpRequestError || request instanceof RpcRequestError || request instanceof TimeoutError
      ? `${/"method":"([^"]+)"/.exec(request.metaMessages?.join(" ") ?? "")?.[1] ?? "rpc"} ${/^[a-z]+:\/\/([^/?#]+)/i.exec(request.url)?.[1] ?? "unknown"}`
      : fetchFailure?.[2]);
  return { code, endpoint, message, name, reason, revert, rpc, status };
}

function classify({ code, endpoint, message, name, reason, revert, rpc, status }: ParsedError) {
  const passkeyNotAllowed =
    name === "NotAllowedError" || (message !== undefined && authPrefixes.some((prefix) => message.startsWith(prefix)));
  const passkeyCancelled =
    (code !== undefined && passkeyCancelledCodes.has(code)) ||
    (message !== undefined && passkeyCancelledPatterns.some((pattern) => pattern.test(message)));
  const passkeyKnown =
    (code !== undefined && passkeyKnownCodes.has(code)) ||
    (message !== undefined &&
      (passkeyKnownPatterns.some((pattern) => pattern.test(message)) ||
        authPrefixes.some((prefix) => message.startsWith(prefix))));
  const passkeyWarning = passkeyKnown && !passkeyCancelled && !passkeyNotAllowed;
  const biometric = code === "ERR_BIOMETRIC";
  const walletRejected = status === "4001" || status === "5000";
  const bundleCancelled = status === "5730";
  const authKnown =
    passkeyKnown ||
    passkeyNotAllowed ||
    biometric ||
    walletRejected ||
    bundleCancelled ||
    message === "invalid operation";
  const network = classifyNetwork(message);
  const knownWarning =
    passkeyKnown || biometric || walletRejected || bundleCancelled || message === "invalid operation";
  const knownInfo = network !== undefined;
  const known = knownWarning || knownInfo;
  const value =
    (name === "APIError" && status !== undefined
      ? [
          ...(message === undefined || message.endsWith("[object Object]") ? [status] : [status, message]),
          ...(endpoint === undefined ? [] : [endpoint]),
        ]
      : undefined) ??
    (revert ? [reason] : undefined) ??
    (authKnown ? [code ?? message ?? "unknown"] : undefined) ??
    (rpc && network === undefined ? rpc : undefined) ??
    (code === undefined || code === "ERR_UNKNOWN"
      ? network === undefined
        ? message === undefined
          ? undefined
          : ["{{ default }}", stableMessage(message)]
        : [network]
      : [code]);
  return {
    authKnown,
    bundleCancelled,
    fingerprint: value,
    known,
    knownInfo,
    knownWarning,
    network,
    passkeyCancelled,
    passkeyKnown,
    passkeyNotAllowed,
    passkeyWarning,
    revert,
    walletRejected,
  };
}

function normalizeMessage(message: string) {
  const value = message.startsWith("Error: ") ? message.slice("Error: ".length) : message;
  return value.trim();
}

function walkCause(error: unknown) {
  const seen = new WeakSet<object>();
  let current = error;
  while (typeof current === "object" && current !== null && "cause" in current && current.cause !== undefined) {
    if (seen.has(current)) return current;
    seen.add(current);
    current = current.cause;
  }
  return current;
}

function classifyNetwork(message: string | undefined) {
  if (message === undefined) return;
  for (const [type, pattern] of networkTypes) if (pattern.test(message)) return type;
}
