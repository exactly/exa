import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import deriveAssociateId from "../../utils/deriveAssociateId";

describe("derive associate id", () => {
  it("should return a 7-character string", () => {
    const account = privateKeyToAddress(generatePrivateKey());
    const id = deriveAssociateId(account);

    expect(id).toHaveLength(7);
  });

  it("should be deterministic", () => {
    const account = privateKeyToAddress(generatePrivateKey());
    const id1 = deriveAssociateId(account);
    const id2 = deriveAssociateId(account);

    expect(id1).toBe(id2);
  });

  it("should return different IDs for different accounts", () => {
    const account1 = privateKeyToAddress(generatePrivateKey());
    const account2 = privateKeyToAddress(generatePrivateKey());
    const id1 = deriveAssociateId(account1);
    const id2 = deriveAssociateId(account2);

    expect(id1).not.toBe(id2);
  });

  it("should be alphanumeric (base36)", () => {
    const account = privateKeyToAddress(generatePrivateKey());
    const id = deriveAssociateId(account);

    expect(id).toMatch(/^[0-9a-z]+$/);
  });
});
