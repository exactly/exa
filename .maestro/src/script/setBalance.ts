import { ethAddress } from "viem";
import { isHex } from "viem/utils";

import anvil from "../anvil";
import { activity } from "../server";

declare const account: string | undefined;
declare const balance: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (!balance || Number.isNaN(Number(balance))) throw new Error("bad balance");

const currentBalance = anvil("eth_getBalance", [account, "latest"]);
anvil("anvil_setBalance", [account, balance]);

activity(ethAddress, account, Math.max(Number(BigInt(balance) - BigInt(currentBalance)) / 1e18, 0));
