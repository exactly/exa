import { decodeJwt } from "jose";
import { generatePrivateKey, privateKeyToAccount, type Address } from "viem/accounts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import getIntercomToken from "../../utils/intercom";

describe("intercom", () => {
  let account: Address;

  beforeEach(() => {
    account = privateKeyToAccount(generatePrivateKey()).address;
  });

  it("returns a valid jwt token", async () => {
    const expires = Date.now() + 3600 * 1000;
    const token = await getIntercomToken(account, expires);

    assert(token);

    const payload = decodeJwt(token);

    expect(payload.sub).toBe(account);
    expect(payload.user_id).toBe(account);
    expect(payload.exp).toBe(Math.floor(expires / 1000));
  });

  it("accepts date object for expires", async () => {
    const expiresDate = new Date(Date.now() + 3600 * 1000);
    const token = await getIntercomToken(account, expiresDate);

    assert(token);

    const payload = decodeJwt(token);

    expect(payload.exp).toBe(Math.floor(expiresDate.getTime() / 1000));
  });
});
