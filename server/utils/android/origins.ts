import { isoBase64URL } from "@simplewebauthn/server/helpers";

import fingerprints from "./fingerprints";

export default [
  ...new Set(
    fingerprints.flatMap((fingerprint) => {
      const hash = isoBase64URL.fromBuffer(Buffer.from(fingerprint.replaceAll(":", ""), "hex"));
      return [`android:apk-key-hash:${hash}`, `android:apk-key-hash:${hash.replaceAll("-", "+").replaceAll("_", "/")}`];
    }),
  ),
];
