import anvil from "../anvil";
import { purchase } from "../server";

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

const { ok, status, body } = http.get(`http://localhost:3000/e2e/card?credential=${encodeURIComponent(credentialId)}`);
if (!ok) throw new Error(`${status} ${body}`);
const card = JSON.parse(body) as { id: string; mode: number };
if (card.mode !== Number(installments)) throw new Error(`bad mode ${card.mode}`);

anvil("anvil_mine", [1, undefined]);
purchase(card.id, Number(amount), merchant);
