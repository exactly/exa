import { zeroAddress } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";

import { credentialSalt, isBusinessSalt } from "../../utils/credentialContext";

afterEach(() => vi.unstubAllEnvs());

describe("credential context", () => {
  it("uses the individual salt when the client FID is not configured", () => {
    expect(credentialSalt("individual")).toBe(zeroAddress);
  });

  it("generates a unique salt for each business credential", () => {
    vi.stubEnv("BUSINESS_CLIENT_FIDS", "business-client");

    const first = credentialSalt("business-client");
    const second = credentialSalt("business-client");

    expect(isBusinessSalt(first)).toBe(true);
    expect(isBusinessSalt(second)).toBe(true);
    expect(second).not.toBe(first);
    expect(isBusinessSalt(credentialSalt("individual"))).toBe(false);
  });
});
