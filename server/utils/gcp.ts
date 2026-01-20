import { captureException, captureMessage, withScope } from "@sentry/node";
import { access, writeFile } from "node:fs/promises";
import { number, object, safeParse, string } from "valibot";

const DECODING_ITERATIONS = 3;
export const GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json";

if (process.env.GCP_PROJECT_ID) {
  if (!process.env.GCP_KMS_KEY_RING) throw new Error("GCP_KMS_KEY_RING is required when using GCP KMS");
  if (!process.env.GCP_KMS_KEY_VERSION) throw new Error("GCP_KMS_KEY_VERSION is required when using GCP KMS");
  if (!process.env.GCP_BASE64_JSON) throw new Error("GCP_BASE64_JSON is required when using GCP KMS");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.GCP_PROJECT_ID))
    throw new Error("GCP_PROJECT_ID must be a valid GCP project ID format");
  if (!/^\d+$/.test(process.env.GCP_KMS_KEY_VERSION))
    throw new Error("GCP_KMS_KEY_VERSION must be a numeric version number");
}

let initializationPromise: null | Promise<void> = null;

export function resetGcpInitialization() {
  initializationPromise = null;
}

export async function initializeGcpCredentials() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    if (await hasCredentials()) {
      return;
    }

    if (process.env.GCP_BASE64_JSON) {
      let json = process.env.GCP_BASE64_JSON;
      for (let index = 0; index < DECODING_ITERATIONS; index++) {
        json = Buffer.from(json, "base64").toString("utf8");
      }
      await writeFile(GOOGLE_APPLICATION_CREDENTIALS, json, { mode: 0o600 });
    } else if (process.env.GCP_PROJECT_ID) {
      throw new Error(
        "gcp project configured but GCP_BASE64_JSON environment variable is not set. " +
          "this is required to initialize gcp kms credentials.",
      );
    }
  })().catch((error: unknown) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

export async function hasCredentials(): Promise<boolean> {
  try {
    await access(GOOGLE_APPLICATION_CREDENTIALS);
    return true;
  } catch {
    return false;
  }
}

export function isRetryableKmsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const numericResult = safeParse(object({ code: number() }), error);
  if (numericResult.success) {
    const code = numericResult.output.code;
    return code === 14 || code === 4 || code === 13 || code === 8;
  }

  const stringResult = safeParse(object({ code: string() }), error);
  if (stringResult.success) {
    const code = stringResult.output.code;
    return (
      code === "UNAVAILABLE" || code === "DEADLINE_EXCEEDED" || code === "INTERNAL" || code === "RESOURCE_EXHAUSTED"
    );
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("unavailable") ||
    message.includes("internal error") ||
    message.includes("service unavailable") ||
    error.name === "NetworkError" ||
    error.name === "TimeoutError"
  );
}

export function trackKmsOperation(operation: string, success: boolean, error?: unknown) {
  if (success) return;
  withScope((scope) => {
    scope.setTag("kms.operation.type", operation);
    scope.setTag("kms.operation.success", "false");
    scope.setTag("kms.operation.result", "failure");
    if (error instanceof Error) {
      captureException(error, { level: "error" });
    } else {
      captureMessage(String(error), { level: "error", extra: { originalError: error } });
    }
  });
}
