import { hexToBigInt } from "viem";
import { describe, expect, it } from "vitest";

import { decode, encode } from "@exactly/common/nonceKey";

describe("nonce key", () => {
  it("decodes the lock code of an onchain nonce", () => {
    expect(decode(hexToBigInt("0x6578612d71720001dd1f1124a4c64601a509849e3ab0b8e50000000000000000"))).toBe(
      "dd1f1124-a4c6-4601-a509-849e3ab0b8e5",
    );
  });

  it("encodes the lock code after the tag and version", () => {
    expect(encode("dd1f1124-a4c6-4601-a509-849e3ab0b8e5")).toBe("0x6578612d71720001dd1f1124a4c64601a509849e3ab0b8e5");
    expect(decode((hexToBigInt(encode("8d0f05d6-fb17-4adc-8003-de9a0ec9c77a")) << 64n) | 7n)).toBe(
      "8d0f05d6-fb17-4adc-8003-de9a0ec9c77a",
    );
  });

  it("rejects a code that is not an uuid", () => {
    expect(() => encode("qr3")).toThrow();
  });

  it.each([
    ["the default key", 5n],
    ["another version", hexToBigInt("0x6578612d71720002dd1f1124a4c64601a509849e3ab0b8e50000000000000000")],
    ["another tag", hexToBigInt("0x6578612d71730001dd1f1124a4c64601a509849e3ab0b8e50000000000000000")],
  ])("ignores %s", (_, nonce) => {
    expect(decode(nonce)).toBeUndefined();
  });
});
