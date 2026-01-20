import { captureException, setTag, withScope } from "@sentry/node";
import { access, writeFile } from "node:fs/promises";

// tokens/credentials are base64-encoded multiple times by deployment tooling
const DECODING_ITERATIONS = 3;
export const GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json";

// this file is necessary because of limitations at runtime to mount volumes to reference
// the GOOGLE_APPLICATION_CREDENTIALS environment variable. we encode the service account's contents
// into a variable and dump those contents to the path set in GOOGLE_APPLICATION_CREDENTIALS
// so the loading can work normally. this will ensure consistency across different environments.
let initializationPromise: null | Promise<void> = null;

// for testing only - reset the initialization state
export function resetGcpInitialization() {
  initializationPromise = null;
}

export async function initializeGcpCredentials() {
  if (initializationPromise) {
    return initializationPromise;
  }

  initializationPromise = (async () => {
    // check if credentials already exist
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
      // if GCP is expected but credentials are missing, throw clear error
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

export function validateGcpConfiguration() {
  if (!process.env.GCP_PROJECT_ID) return;

  const errors: string[] = [];

  if (!process.env.GCP_KMS_KEY_RING) {
    errors.push("GCP_KMS_KEY_RING is required when using GCP KMS");
  }

  if (!process.env.GCP_KMS_KEY_VERSION) {
    errors.push("GCP_KMS_KEY_VERSION is required when using GCP KMS");
  }

  if (!process.env.GCP_BASE64_JSON) {
    errors.push("GCP_BASE64_JSON is required when using GCP KMS");
  }

  if (process.env.GCP_PROJECT_ID && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.GCP_PROJECT_ID)) {
    errors.push("GCP_PROJECT_ID must be a valid GCP project ID format");
  }

  if (process.env.GCP_KMS_KEY_VERSION && !/^\d+$/.test(process.env.GCP_KMS_KEY_VERSION)) {
    errors.push("GCP_KMS_KEY_VERSION must be a numeric version number");
  }

  if (errors.length > 0) {
    throw new Error(`GCP KMS configuration errors:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
}

export function isRetryableKmsError(error: unknown): boolean {
  if (error instanceof Error) {
    if ("code" in error && typeof error.code === "number") {
      return (
        error.code === 14 || // UNAVAILABLE
        error.code === 4 || // DEADLINE_EXCEEDED
        error.code === 13 || // INTERNAL
        error.code === 8 // RESOURCE_EXHAUSTED
      );
    }

    if ("code" in error && typeof error.code === "string") {
      return (
        error.code === "UNAVAILABLE" ||
        error.code === "DEADLINE_EXCEEDED" ||
        error.code === "INTERNAL" ||
        error.code === "RESOURCE_EXHAUSTED"
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
  return false;
}

export function trackKmsOperation(operation: string, success: boolean, error?: unknown) {
  setTag("kms.operation.type", operation);
  setTag("kms.operation.success", String(success));

  if (success) {
    setTag("kms.operation.result", "success");
  } else {
    if (error instanceof Error) {
      withScope((scope) => {
        scope.setTag("kms.operation.type", operation);
        scope.setTag("kms.operation.success", String(success));
        scope.setTag("kms.operation.result", "failure");
        captureException(error, {
          level: "error",
          tags: {},
        });
      });
    }
  }
}
