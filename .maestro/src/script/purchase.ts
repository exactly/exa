import { decodeEventLog, hexToBigInt, padHex, parseUnits, toHex } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { marketAbi, marketUSDCAddress } from "@exactly/common/generated/chain";

import anvil from "../anvil";
import { purchase } from "../server";

declare const account: string | undefined;
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
if (account !== undefined && !isHex(account)) throw new Error("bad account");

let card: { id: string; mode: number; userId: string };
for (const deadline = Date.now() + 30_000; ; ) {
  const { ok, status, body } = http.get(
    `http://localhost:3000/e2e/card?credential=${encodeURIComponent(credentialId)}`,
  );
  if (!ok) throw new Error(`${status} ${body}`);
  card = JSON.parse(body) as typeof card;
  if (card.mode === Number(mode)) break;
  if (Date.now() >= deadline) throw new Error(`bad mode ${card.mode}`);
}

const networks = [undefined, "Anvil2"];
const blocks = networks.map((network) => {
  anvil("anvil_mine", [1, undefined], network);
  return anvil("eth_blockNumber", [], network);
});
for (let index = 0; index < Number(count ?? 1); index++) {
  purchase(card.id, card.userId, Number(amount), merchant, declinedReason);
}

if (account) {
  const parts = networks.map((network, index) =>
    anvil(
      "eth_getLogs",
      [
        {
          address: marketUSDCAddress,
          fromBlock: toHex(hexToBigInt(blocks[index] ?? "0x0") + 1n),
          topics: [toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" })), null, null, padHex(account)],
        },
      ],
      network,
    ).reduce(
      (total, { data, topics }) =>
        total + decodeEventLog({ abi: marketAbi, eventName: "Withdraw", data, topics }).args.assets,
      0n,
    ),
  );
  if (parts.includes(0n) || parts.reduce((total, part) => total + part, 0n) !== parseUnits(amount, 6)) {
    throw new Error(`bad split ${parts.join(",")}`);
  }
}
