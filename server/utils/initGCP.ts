import { existsSync, writeFileSync } from "node:fs";

const DECODING_ITERATIONS = 3;
export const GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json";

// This file is necessary because of limitations at runtime to mount volumes to reference
// the GOOGLE_APPLICATION_CREDENTIALS environment variable. We encode the service account's contents
// into a variable and dump those contents to the path set in GOOGLE_APPLICATION_CREDENTIALS
// so the loading can work normally. This will ensure consistency across different environments.

// Top-level initialization - runs when module is imported
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

// Helper function to check if credentials file exists
export function hasCredentials(): boolean {
  return existsSync(GOOGLE_APPLICATION_CREDENTIALS);
}
