import { isHex } from "viem/utils";

import anvil from "../anvil";

declare const token: string | undefined;
declare const account: string | undefined;
declare const amount: string | undefined;

if (!token || !isHex(token)) throw new Error("bad token");
if (!account || !isHex(account)) throw new Error("bad account");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

anvil("anvil_setBalance", [account, amount]);
