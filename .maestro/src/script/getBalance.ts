import { erc20Abi, formatUnits, hexToNumber, zeroAddress, type Address } from "viem";
import { isHex } from "viem/utils";

import anvil, { readContract } from "../anvil";

declare const asset: string | undefined;
declare const account: string | undefined;
declare const output: { balance: number };

if (!account || !isHex(account)) throw new Error("bad account");

const { ok, status, body } = http.get("http://localhost:3000/e2e/lifi/v1/tokens");
if (!ok) throw new Error(`${status} ${body}`);
const token = (
  JSON.parse(body) as { tokens: Record<number, { address: Address; decimals: number; symbol: string }[]> }
).tokens[hexToNumber(anvil("eth_chainId", []))]?.find(({ symbol }) => symbol === asset);
if (!token) throw new Error("bad asset");

output.balance = Number(
  formatUnits(
    token.address === zeroAddress
      ? BigInt(anvil("eth_getBalance", [account, "latest"]))
      : readContract({ address: token.address, functionName: "balanceOf", abi: erc20Abi, args: [account] }),
    token.decimals,
  ),
);
