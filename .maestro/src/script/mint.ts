import { ethAddress } from "viem";
import { isHex, parseUnits } from "viem/utils";

import { exaPreviewerAbi, exaPreviewerAddress } from "@exactly/common/generated/chain";

import anvil, { readContract, writeContract } from "../anvil";
import { activity } from "../server";

declare const asset: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;
declare const output: { usd: number };

if (!asset) throw new Error("missing asset");
if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const markets = readContract({ address: exaPreviewerAddress, functionName: "markets", abi: exaPreviewerAbi });
const market = markets.find(({ symbol }) => symbol === (asset === "ETH" ? "WETH" : asset));
if (!market) throw new Error("bad asset");

output.usd = Math.round((Number(amount) * Number(market.usdPrice)) / 1e18);

if (asset === "ETH") {
  const current = BigInt(anvil("eth_getBalance", [to, "latest"]));
  anvil("anvil_setBalance", [to, String(current + parseUnits(amount, 18))]);
  activity(ethAddress, to, Number(amount));
} else {
  activity(
    market.asset,
    to,
    Number(amount),
    writeContract({
      address: market.asset,
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
      args: [to, parseUnits(amount, market.decimals)],
    }),
  );
}
