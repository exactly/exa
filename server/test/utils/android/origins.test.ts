import { describe, expect, it, vi } from "vitest";

import origins from "../../../utils/android/origins";

vi.mock("../../../utils/android/fingerprints", () => ({ default: ["FB:FF:BF", "00:00:00"] }));

describe("android origins", () => {
  it("accepts key hashes in base64url and base64 once each", () => {
    expect(origins).toStrictEqual([
      "android:apk-key-hash:-_-_",
      "android:apk-key-hash:+/+/",
      "android:apk-key-hash:AAAA",
    ]);
  });
});
