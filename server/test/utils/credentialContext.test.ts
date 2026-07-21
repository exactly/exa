import { zeroAddress } from "viem";
import { describe, expect, it } from "vitest";

import { credentialSalt, isBusinessSalt } from "../../utils/credentialContext";

describe("credential context", () => {
  it("uses the individual salt when the client FID is not configured", () => {
    expect(credentialSalt("individual")).toBe(zeroAddress);
  });

  it("generates a unique salt for each business credential", () => {
    const first = credentialSalt("business");
    const second = credentialSalt("business");

    expect(isBusinessSalt(first)).toBe(true);
    expect(isBusinessSalt(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(credentialSalt("business-client")).toBe(zeroAddress);
    expect(isBusinessSalt(credentialSalt("individual"))).toBe(false);
  });
});
