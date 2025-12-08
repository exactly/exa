import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { ethAddress, keccak256, toBytes, toHex, zeroAddress, zeroHash, type Address, type Hash } from "viem";
import { publicKeyToAddress } from "viem/accounts";

export function activity(asset: Address, toAddress: Address, value: number, hash: Hash = zeroHash) {
  const payload = JSON.stringify({
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "ANVIL",
      activity: [
        {
          asset,
          toAddress,
          value,
          hash,
          fromAddress: zeroAddress,
          category: asset === ethAddress ? "external" : "erc20",
          rawContract: asset === ethAddress ? undefined : { address: asset },
        },
      ],
    },
  });
  const { ok, status, body } = http.post("http://localhost:3000/hooks/activity", {
    headers: {
      "content-type": "application/json",
      "x-alchemy-signature": bytesToHex(hmac(sha256, utf8ToBytes("activity"), utf8ToBytes(payload))),
    },
    body: payload,
  });
  if (!ok) throw new Error(`${status} ${body}`);
}

export const keeper = publicKeyToAddress(toHex(secp256k1.getPublicKey(keccak256(toBytes("e2e.ts"), "bytes"), false)));
