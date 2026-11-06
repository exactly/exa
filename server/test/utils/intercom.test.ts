import { decodeJwt } from "jose";
import { parse } from "valibot";
import { zeroAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { assert, beforeEach, describe, expect, it } from "vitest";

import { business } from "@exactly/common/tenants";
import { Address } from "@exactly/common/validation";

import intercom from "../../utils/intercom";

const getIntercomToken = intercom("intercom");

describe("intercom", () => {
  let account: Address;

  beforeEach(() => {
    account = parse(Address, privateKeyToAccount(generatePrivateKey()).address);
  });

  it("returns a valid jwt token", async () => {
    const expires = Date.now() + 3600 * 1000;
    const token = await getIntercomToken(account, expires, parse(Address, zeroAddress));

    assert(token);

    const payload = decodeJwt(token);

    expect(payload.sub).toBe(account);
    expect(payload.user_id).toBe(account);
    expect(payload.exp).toBe(Math.floor(expires / 1000));
    expect(payload).not.toHaveProperty("exa_profile");
  });

  it("accepts date object for expires", async () => {
    const expiresDate = new Date(Date.now() + 3600 * 1000);
    const token = await getIntercomToken(account, expiresDate, parse(Address, zeroAddress));

    assert(token);

    const payload = decodeJwt(token);

    expect(payload.exp).toBe(Math.floor(expiresDate.getTime() / 1000));
  });

  it("signs the business profile for the business tenant", async () => {
    const token = await getIntercomToken(account, Date.now() + 3600 * 1000, business);

    expect(decodeJwt(token)).toStrictEqual({
      sub: account,
      user_id: account,
      exa_profile: "business",
      iat: expect.any(Number) as unknown,
      exp: expect.any(Number) as unknown,
    });
  });
});
