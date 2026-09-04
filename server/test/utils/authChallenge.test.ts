import { describe, expect, it } from "vitest";

import { decode, encode } from "../../utils/authChallenge";

describe("auth challenge", () => {
  it("preserves the legacy format for ordinary challenges", () => {
    expect(encode("challenge")).toBe("challenge");
    expect(decode(encode("challenge"))).toStrictEqual({ challenge: "challenge" });
  });

  it("stores the account type for business challenges", () => {
    const challenge = encode("challenge", "business");

    expect(challenge).toBe(JSON.stringify({ challenge: "challenge", accountType: "business" }));
    expect(decode(challenge)).toStrictEqual({ challenge: "challenge", accountType: "business" });
  });
});
