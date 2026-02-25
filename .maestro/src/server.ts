import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import {
  encodeAbiParameters,
  erc20Abi,
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
import { parseUnits } from "viem/utils";

import { readContract } from "./anvil";

export function activity(asset: Address, toAddress: Address, value: number, hash: Hash = zeroHash) {
  const payload = JSON.stringify({
    type: "ADDRESS_ACTIVITY",
    event: {
      network: "ANVIL",
      activity: [
        {
          asset: asset === ethAddress ? "ETH" : asset,
          toAddress,
          value,
          hash,
          fromAddress: zeroAddress,
          category: asset === ethAddress ? "external" : "erc20",
          rawContract: {
            ...(asset === ethAddress ? {} : { address: asset }),
            rawValue: toHex(
              parseUnits(
                value.toLocaleString("fullwide", { useGrouping: false, maximumFractionDigits: 18 }),
                asset === ethAddress ? 18 : readContract({ address: asset, functionName: "decimals", abi: erc20Abi }),
              ),
            ),
          },
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
    amount: bigint;
    data: Hex;
    market: Address;
    nonce: bigint;
    proposalType: number;
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

export function persona(referenceId: string, event = "approved") {
  const payload = JSON.stringify({
    data: {
      attributes: {
        payload: {
          data: {
            id: "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2",
            attributes: {
              status: event,
              referenceId,
              emailAddress: "test@test.com",
              phoneNumber: "+12125551234",
              birthdate: "1990-01-01",
              nameFirst: "Test",
              nameMiddle: null,
              nameLast: "User",
              addressStreet1: "123 Test St",
              addressStreet2: null,
              addressCity: "New York",
              addressSubdivision: "New York",
              addressSubdivisionAbbr: "NY",
              addressPostalCode: "10001",
              fields: {
                inputSelect: { value: "Science" },
                accountPurpose: { value: "Travel Usage" },
                annualSalary: { value: "30000" },
                expectedMonthlyVolume: { value: "3000" },
                addressCountryCode: { value: "US" },
                nameFirst: { value: "Test" },
                nameLast: { value: "User" },
                birthdate: { value: "1990-01-01" },
                emailAddress: { value: "test@test.com" },
                identificationNumber: { value: "123456789" },
                monthlyPurchasesRange: { value: "3000" },
                identificationClass: { value: "pp" },
                currentGovernmentId: { value: { id: "doc_yc294YWhCZi7YKxPnoxCGMmCH111" } }, // cspell:ignore doc_yc294YWhCZi7YKxPnoxCGMmCH111
                selectedCountryCode: { value: "TW" },
              },
            },
            relationships: {
              inquiryTemplate: {
                data: {
                  id: "itmpl_1igCJVqgf3xuzqKYD87HrSaDavU2",
                },
              },
            },
          },
          included: [
            { type: "inquiry-session", attributes: { createdAt: new Date().toISOString(), ipAddress: "127.0.0.1" } },
          ],
        },
      },
    },
  });
  const t = Date.now();
  const { ok, status, body } = http.post("http://localhost:3000/hooks/persona", {
    headers: {
      "content-type": "application/json",
      "persona-signature": `t=${t},v1=${bytesToHex(
        hmac(sha256, utf8ToBytes("persona"), utf8ToBytes(`${t}.${payload}`)),
      )}`,
    },
    body: payload,
  });
  if (!ok) throw new Error(`${status} ${body}`);
}

export const keeper = publicKeyToAddress(toHex(secp256k1.getPublicKey(keccak256(toBytes("e2e.ts"), "bytes"), false)));
