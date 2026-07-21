import { randomBytes } from "node:crypto";
import { parse } from "valibot";
import { bytesToHex, zeroAddress } from "viem";

import { Address } from "@exactly/common/validation";

export function credentialSalt(source?: string) {
  if (
    !source ||
    !new Set(
      (process.env.BUSINESS_CLIENT_FIDS ?? "")
        .split(",")
        .map((fid) => fid.trim())
        .filter(Boolean),
    ).has(source)
  )
    return parse(Address, zeroAddress);

  let salt: Address;
  do salt = parse(Address, bytesToHex(randomBytes(20)));
  while (salt.toLowerCase() === zeroAddress);

  return salt;
}

export function isBusinessSalt(salt: Address) {
  return salt.toLowerCase() !== zeroAddress;
}
