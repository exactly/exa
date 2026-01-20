import { captureException, setTag } from "@sentry/node";
import { existsSync, writeFileSync } from "node:fs";

const DECODING_ITERATIONS = 3;
export const GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json";

// This file is necessary because of limitations at runtime to mount volumes to reference
// the GOOGLE_APPLICATION_CREDENTIALS environment variable. We encode the service account's contents
// into a variable and dump those contents to the path set in GOOGLE_APPLICATION_CREDENTIALS
// so the loading can work normally. This will ensure consistency across different environments.
if (process.env.GCP_BASE64_JSON) {
  let json = process.env.GCP_BASE64_JSON;
  for (let index = 0; index < DECODING_ITERATIONS; index++) {
    json = Buffer.from(json, "base64").toString("utf8");
  }
  writeFileSync(GOOGLE_APPLICATION_CREDENTIALS, json);
} else if (process.env.GCP_PROJECT_ID) {
  // If GCP is expected but credentials are missing, throw clear error
  throw new Error(
    "gcp project configured but GCP_BASE64_JSON environment variable is not set. " +
      "this is required to initialize gcp kms credentials.",
  );
}

export function hasCredentials(): boolean {
  return existsSync(GOOGLE_APPLICATION_CREDENTIALS);
}

export function validateGcpConfiguration() {
  if (!process.env.GCP_PROJECT_ID) return; // GCP is optional

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

  // Validate project ID format (basic validation)
  if (process.env.GCP_PROJECT_ID && !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(process.env.GCP_PROJECT_ID)) {
    errors.push("GCP_PROJECT_ID must be a valid GCP project ID format");
  }

  // Validate key version is numeric
  if (process.env.GCP_KMS_KEY_VERSION && !/^\d+$/.test(process.env.GCP_KMS_KEY_VERSION)) {
    errors.push("GCP_KMS_KEY_VERSION must be a numeric version number");
  }

  if (errors.length > 0) {
    throw new Error(`GCP KMS configuration errors:\n${errors.map((error) => `  - ${error}`).join("\n")}`);
  }
}

export function isRetryableKmsError(error: unknown): boolean {
  if (error instanceof Error) {
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
  setTag("kms.operation.success", success);

  if (success) {
    setTag("kms.operation.result", "success");
  } else {
    setTag("kms.operation.result", "failure");

    if (error instanceof Error) {
      captureException(error, {
        level: "error",
        tags: {
          "kms.operation": operation,
        },
      });
    }
  }
}
