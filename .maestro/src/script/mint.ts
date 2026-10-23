import { ethAddress, hexToNumber, zeroAddress, type Address } from "viem";
import { isHex, parseUnits } from "viem/utils";

import anvil, { writeContract } from "../anvil";
import { activity } from "../server";

declare const asset: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;
declare const network: string | undefined;
declare const output: { usd: number };

if (!asset) throw new Error("missing asset");
if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const { ok, status, body } = http.get("http://localhost:3000/e2e/lifi/v1/tokens");
if (!ok) throw new Error(`${status} ${body}`);
const token = (
  JSON.parse(body) as {
    tokens: Record<number, { address: Address; decimals: number; priceUSD: string; symbol: string }[]>;
  }
).tokens[hexToNumber(anvil("eth_chainId", [], network))]?.find(({ symbol }) => symbol === asset);
if (!token) throw new Error("bad asset");

output.usd = Math.round(Number(amount) * Number(token.priceUSD));

if (token.address === zeroAddress) {
  const current = BigInt(anvil("eth_getBalance", [to, "latest"], network));
  anvil("anvil_setBalance", [to, String(current + parseUnits(amount, 18))], network);
  activity(ethAddress, to, Number(amount), undefined, network);
} else {
  activity(
    token.address,
    to,
    Number(amount),
    writeContract(
      {
        address: token.address,
        functionName: "mint",
        abi: [
          {
            type: "function",
            name: "mint",
            inputs: [
              { name: "to", type: "address" },
              { name: "value", type: "uint256" },
            ],
            outputs: [],
            stateMutability: "nonpayable",
          },
        ],
        args: [to, parseUnits(amount, token.decimals)],
      },
      network,
    ),
    network,
  );
}
