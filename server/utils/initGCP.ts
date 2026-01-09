import { writeFileSync } from "node:fs";

// This file is necessary because of limitations at runtime to mount volumes to reference
// the GOOGLE_APPLICATION_CREDENTIALS environment variable. We encode the service account's contents
// into a variable and dump those contents to the path set in GOOGLE_APPLICATION_CREDENTIALS
// so the loading can work normally. This will ensure consistency across different environments.
(() => {
  if (process.env.GCP_BASE64_JSON) {
    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      throw new Error("GCP_BASE64_JSON is set but GOOGLE_APPLICATION_CREDENTIALS is not");
    }

    const json = Buffer.from(process.env.GCP_BASE64_JSON, "base64").toString("utf8");
    writeFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, json);
  }
})();