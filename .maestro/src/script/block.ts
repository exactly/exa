import { hexToNumber } from "viem";

import anvil from "../anvil";

declare const network: string | undefined;
declare const output: { block: number };

output.block = hexToNumber(anvil("eth_blockNumber", [], network));
