import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import verifySignature from "../../utils/verifySignature";

const key = "test-key";

describe("verify signature", () => {
  it("should return true when the signature is valid", () => {
    const payload = new ArrayBuffer(10);
    const signature = createHmac("sha256", key).update(Buffer.from(payload)).digest("hex");

    expect(verifySignature({ signature, signingKey: key, payload })).toBe(true);
  });

  it("should return false when the signature is invalid", () => {
    const payload = new ArrayBuffer(10);
    const signature = createHmac("sha256", "other-key").update(Buffer.from(payload)).digest("hex");

    expect(verifySignature({ signature, signingKey: key, payload })).toBe(false);
  });

  it("should return false when the signature is missing", () => {
    const payload = new ArrayBuffer(10);
    const signature = undefined;

    expect(verifySignature({ signature, signingKey: key, payload })).toBe(false);
  });
});
