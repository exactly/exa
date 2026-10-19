import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

import anvil from "../anvil";
import { persona, purchase } from "../server";

declare const amount: string | undefined;
declare const credentialId: string | undefined;
declare const installments: string | undefined;
declare const merchant: string | undefined;

if (!amount || !(Number(amount) > 0)) throw new Error("bad amount");
if (!credentialId) throw new Error("missing credential");
if (!installments || !(Number.isSafeInteger(Number(installments)) && Number(installments) > 1)) {
  throw new Error("bad installments");
}
if (!merchant) throw new Error("missing merchant");

persona(credentialId);

const cookie = `credential_id=${encodeURIComponent(
  `${credentialId}.${base64(hmac(sha256, utf8ToBytes("auth"), utf8ToBytes(credentialId)))}`,
)}`;

const created = http.post("http://localhost:3000/api/card", { headers: { cookie }, body: "" });
if (!created.ok) throw new Error(`${created.status} ${created.body}`);
const mode = http.request("http://localhost:3000/api/card", {
  method: "PATCH",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ mode: Number(installments) }),
});
if (!mode.ok) throw new Error(`${mode.status} ${mode.body}`);
const card = http.request("http://localhost:3000/api/card", { method: "GET", headers: { cookie } });
if (!card.ok) throw new Error(`${card.status} ${card.body}`);

anvil("anvil_mine", [1, undefined]);
purchase((JSON.parse(card.body) as { cardId: string }).cardId, Number(amount), merchant);

function base64(bytes: Uint8Array) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = ((bytes[index] ?? 0) << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    for (let position = 0; position < 4; position++) {
      result += position <= bytes.length - index ? alphabet.charAt((chunk >> (18 - 6 * position)) & 63) : "=";
    }
  }
  return result;
}
