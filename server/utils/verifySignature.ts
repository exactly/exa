import { createHmac, timingSafeEqual } from "node:crypto";

export interface VerifySignature {
  signature: string | undefined;
  signingKey: string;
  payload: ArrayBuffer;
}

export default function verifySignature({ signature, signingKey, payload }: VerifySignature): boolean {
  if (!signature) return false;
  const expectedSignature = createHmac("sha256", signingKey).update(Buffer.from(payload)).digest("hex");
  return timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(expectedSignature, "hex"));
}
