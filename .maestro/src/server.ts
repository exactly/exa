import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  encodeAbiParameters,
  ethAddress,
  keccak256,
  pad,
  toBytes,
  toHex,
  zeroAddress,
  zeroHash,
  type Address,
  type Hash,
  type Hex,
} from "viem";
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

export function block(
  account: Address,
  proposals: {
    nonce: bigint;
    market: Address;
    proposalType: number;
    amount: bigint;
    data: Hex;
    unlock: bigint;
  }[],
) {
  const payload = JSON.stringify({
    type: "GRAPHQL",
    event: {
      data: {
        block: {
          timestamp: Math.floor(Date.now() / 1000),
          logs: proposals.map(({ nonce, market, proposalType, amount, data, unlock }) => ({
            topics: [
              "0x4cf7794d9c19185f7d95767c53e511e2e67ae50f68ece9c9079c6ae83403a3e7", // Proposed
              pad(account),
              pad(toHex(nonce)),
              pad(market),
            ],
            data: encodeAbiParameters(
              [{ type: "uint8" }, { type: "uint256" }, { type: "bytes" }, { type: "uint256" }],
              [proposalType, amount, data, unlock],
            ),
            account: { address: account },
          })),
        },
      },
    },
  });
  const { ok, status, body } = http.post("http://localhost:3000/hooks/block", {
    headers: {
      "content-type": "application/json",
      "x-alchemy-signature": bytesToHex(hmac(sha256, utf8ToBytes("block"), utf8ToBytes(payload))),
    },
    body: payload,
  });
  if (!ok) throw new Error(`${status} ${body}`);
}

export const keeper = publicKeyToAddress(toHex(secp256k1.getPublicKey(keccak256(toBytes("e2e.ts"), "bytes"), false)));
