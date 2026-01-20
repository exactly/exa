import { access, writeFile } from "node:fs/promises";
import { number, object, safeParse, string } from "valibot";

const DECODING_ITERATIONS = 3;
export const GOOGLE_APPLICATION_CREDENTIALS = "/tmp/gcp-service-account.json";

if (!process.env.GCP_BASE64_JSON) throw new Error("GCP_BASE64_JSON is required when using GCP KMS");
const gcpBase64Json = process.env.GCP_BASE64_JSON;

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

    let json = gcpBase64Json;
    for (let index = 0; index < DECODING_ITERATIONS; index++) {
      json = Buffer.from(json, "base64").toString("utf8");
    }
    await writeFile(GOOGLE_APPLICATION_CREDENTIALS, json, { mode: 0o600 });
  })().catch((error: unknown) => {
    initializationPromise = null;
    throw error;
  });

  return initializationPromise;
}

export async function hasCredentials(): Promise<boolean> {
  return access(GOOGLE_APPLICATION_CREDENTIALS)
    .then(() => true)
    .catch(() => false);
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
