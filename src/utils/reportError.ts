import { captureException, withScope } from "@sentry/react-native";

export default function reportError(error: unknown, hint?: Parameters<typeof captureException>[1]) {
  console.error(error); // eslint-disable-line no-console
  const classification = classify(parseError(error));
  try {
    const value = classification.fingerprint;
    const known = classification.known;
    if (!known && value === undefined) return captureException(error, hint);
    let eventId: ReturnType<typeof captureException> | undefined;
    withScope((scope) => {
      if (known) scope.setLevel("warning");
      if (value !== undefined) scope.setFingerprint(value);
      eventId = captureException(error, hint);
    });
    return eventId;
  } catch (sentryError) {
    console.error(sentryError); // eslint-disable-line no-console
  }
}

const passkeyCancelledMessages = new Set([
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1001.)",
  "The operation couldn’t be completed. (com.apple.AuthenticationServices.AuthorizationError error 1004.)",
  "The operation couldn’t be completed. Device must be unlocked to perform request.",
  "UserCancelled",
]);
const passkeyKnownMessages = new Set([
  ...passkeyCancelledMessages,
  "The operation couldn’t be completed. Stolen Device Protection is enabled and biometry is required.",
]);
const authPrefixes = ["androidx.credentials.exceptions.domerrors.NotAllowedError"];
const networkTypes = [
  ["offline", /internet connection appears to be offline/i],
  ["timeout", /request timed out|request took too long to respond/i],
  ["tls", /tls error caused the secure connection to fail/i],
  ["lost", /network connection was lost/i],
] as const;
type ParsedError = ReturnType<typeof parseError>;

export function isPasskeyCancelled(error: unknown) {
  return classify(parseError(error)).passkeyCancelled;
}

export function classifyError(error: unknown) {
  return classify(parseError(error));
}

function parseError(error: unknown) {
  const code =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.length > 0
      ? error.code
      : undefined;
  const status =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "number" &&
    Number.isFinite(error.code)
      ? String(error.code)
      : undefined;
  const name =
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    typeof error.name === "string" &&
    error.name.length > 0
      ? error.name
      : undefined;
  const message =
    error instanceof Error
      ? normalizeMessage(error.message)
      : typeof error === "string"
        ? normalizeMessage(error)
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof error.message === "string" &&
            error.message.length > 0
          ? normalizeMessage(error.message)
          : undefined;
  return { code, name, message, status };
}

function classify({ code, name, message, status }: ParsedError) {
  const passkeyNotAllowed =
    name === "NotAllowedError" || (message !== undefined && authPrefixes.some((prefix) => message.startsWith(prefix)));
  const passkeyCancelled = message !== undefined && passkeyCancelledMessages.has(message);
  const passkeyKnown =
    message !== undefined &&
    (passkeyKnownMessages.has(message) ||
      message.includes("Biometrics must be enabled") ||
      message.includes("There is already a pending passkey request") ||
      authPrefixes.some((prefix) => message.startsWith(prefix)));
  const passkeyWarning = passkeyKnown && !passkeyCancelled && !passkeyNotAllowed;
  const biometric = code === "ERR_BIOMETRIC";
  const authKnown = passkeyKnown || passkeyNotAllowed || biometric || message === "invalid operation";
  const network = classifyNetwork(message);
  const known =
    passkeyKnown ||
    biometric ||
    message === "invalid operation" ||
    message === "Network request failed" ||
    network === "offline" ||
    network === "lost";
  const fingerprintMessage =
    message?.startsWith("Calling the 'get' function has failed") ||
    message?.startsWith("The operation couldn’t be completed.")
      ? message
      : undefined;
  const value =
    (name === "APIError" && status !== undefined
      ? message === undefined || message.endsWith("[object Object]")
        ? ["{{ default }}", "api", status]
        : ["{{ default }}", "api", status, message]
      : undefined) ??
    (code === undefined || code === "ERR_UNKNOWN"
      ? network === undefined
        ? fingerprintMessage === undefined
          ? undefined
          : ["{{ default }}", fingerprintMessage]
        : ["{{ default }}", network]
      : ["{{ default }}", code]);
  return { passkeyKnown, passkeyCancelled, passkeyNotAllowed, passkeyWarning, authKnown, known, fingerprint: value };
}

function normalizeMessage(message: string) {
  const value = message.startsWith("Error: ") ? message.slice("Error: ".length) : message;
  return value.trim();
}

function classifyNetwork(message: string | undefined) {
  if (message === undefined) return;
  for (const [type, pattern] of networkTypes) if (pattern.test(message)) return type;
}
