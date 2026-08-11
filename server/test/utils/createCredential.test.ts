import { bytesToHex, zeroAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialSalt, isBusinessSalt } from "../../utils/createCredential";

import type * as NodeCrypto from "node:crypto";

const randomBytes = vi.hoisted(() => vi.fn((size: number) => Buffer.alloc(size)));

vi.mock("node:crypto", async (importOriginal) => {
  const original = await importOriginal<typeof NodeCrypto>();
  randomBytes.mockImplementation((size) => original.randomBytes(size));
  return { ...original, randomBytes };
});

afterEach(() => randomBytes.mockClear());

describe("credential salt", () => {
  it("uses the individual salt by default", () => {
    expect(credentialSalt()).toBe(zeroAddress);
  });

  it("uses a business salt for the business account type", () => {
    expect(isBusinessSalt(credentialSalt("business"))).toBe(true);
  });

  it("generates a unique salt for each business credential", () => {
    const first = credentialSalt("business");
    const second = credentialSalt("business");

    expect(isBusinessSalt(first)).toBe(true);
    expect(isBusinessSalt(second)).toBe(true);
    expect(second).not.toBe(first);
  });

  it("regenerates a zero business salt", () => {
    const salt = Buffer.alloc(20, 1);
    randomBytes.mockReturnValueOnce(Buffer.alloc(20)).mockReturnValueOnce(salt);

    expect(credentialSalt("business")).toBe(bytesToHex(salt));
    expect(randomBytes).toHaveBeenCalledTimes(2);
  });
});
