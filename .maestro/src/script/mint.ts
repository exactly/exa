import { exaPreviewerAbi, exaPreviewerAddress, mockErc20Abi } from "@exactly/common/generated/chain";
import { isHex, parseUnits } from "viem/utils";

import { readContract, writeContract } from "../anvil";
import { activity } from "../server";

declare const asset: string | undefined;
declare const to: string | undefined;
declare const amount: string | undefined;

if (!asset) throw new Error("missing asset");
if (!to || !isHex(to)) throw new Error("bad to");
if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const market = readContract({ address: exaPreviewerAddress, functionName: "markets", abi: exaPreviewerAbi }).find(
  ({ symbol }) => symbol === asset,
);

if (!market) throw new Error("bad asset");

activity(
  market.asset,
  to,
  Number(amount),
  writeContract({
    address: market.asset,
    functionName: "mint",
    abi: mockErc20Abi,
    args: [to, parseUnits(amount, market.decimals)],
  }),
);
