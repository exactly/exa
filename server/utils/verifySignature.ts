import { createHmac, timingSafeEqual } from "node:crypto";

export type VerifySignature = {
  payload: ArrayBuffer;
  signature: string | undefined;
  signingKey: string;
};

export default function verifySignature({ signature, signingKey, payload }: VerifySignature): boolean {
  if (!signature) return false;
  const expectedSignature = createHmac("sha256", signingKey).update(Buffer.from(payload)).digest("hex");
  const received = Buffer.from(signature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}
