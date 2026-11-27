import { isHex } from "viem/utils";

import anvil from "../anvil";

declare const address: string | undefined;
declare const code: string | undefined;
declare const network: string | undefined;
declare const output: { code: string };

if (!address || !isHex(address)) throw new Error("bad address");
if (!code || !isHex(code)) throw new Error("bad code");

output.code = anvil("eth_getCode", [address, "latest"], network);
anvil("anvil_setCode", [address, code], network);
