import { isHex } from "viem/utils";

import anvil from "../anvil";

declare const account: string | undefined;
declare const network: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

for (const deadline = Date.now() + 30_000; anvil("eth_getCode", [account, "latest"], network) === "0x"; ) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for deployment");
}
