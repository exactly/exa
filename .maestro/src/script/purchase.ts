import anvil from "../anvil";
import { purchase } from "../server";

declare const amount: string | undefined;
declare const count: string | undefined;
declare const credentialId: string | undefined;
declare const declinedReason: string | undefined;
declare const merchant: string | undefined;
declare const mode: string | undefined;

if (!amount || !(Number(amount) > 0)) throw new Error("bad amount");
if (!credentialId) throw new Error("missing credential");
if (!mode || !(Number.isSafeInteger(Number(mode)) && Number(mode) >= 0)) throw new Error("bad mode");
if (!merchant) throw new Error("missing merchant");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");

let card: { id: string; mode: number };
for (const deadline = Date.now() + 30_000; ; ) {
  const { ok, status, body } = http.get(
    `http://localhost:3000/e2e/card?credential=${encodeURIComponent(credentialId)}`,
  );
  if (!ok) throw new Error(`${status} ${body}`);
  card = JSON.parse(body) as typeof card;
  if (card.mode === Number(mode)) break;
  if (Date.now() >= deadline) throw new Error(`bad mode ${card.mode}`);
}

anvil("anvil_mine", [1, undefined]);
for (let index = 0; index < Number(count ?? 1); index++) purchase(card.id, Number(amount), merchant, declinedReason);
