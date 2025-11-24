import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Address, Hash } from "viem";

// eslint-disable-next-line import/prefer-default-export
export function activity(
  asset: string,
  toAddress: Address,
  value: number,
  hash: Hash = "0x0000000000000000000000000000000000000000000000000000000000000000",
) {
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
          category: asset === "ETH" ? "external" : "erc20",
          fromAddress: "0x0000000000000000000000000000000000000000",
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
  console.log(body);
}
