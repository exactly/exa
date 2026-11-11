import { parse, pipe, string, uuid } from "valibot";
import { concat, numberToHex, stringToHex } from "viem";

const prefix = stringToHex("exa-qr\u0000\u0001");

export function encode(code: string) {
  return concat([prefix, `0x${parse(pipe(string(), uuid()), code).split("-").join("")}`]);
}

export function decode(nonce: bigint) {
  const key = numberToHex(nonce >> 64n, { size: 24 });
  if (!key.startsWith(prefix)) return;
  const id = key.slice(prefix.length);
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
