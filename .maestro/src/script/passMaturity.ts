import { hexToBigInt } from "viem";
import { isHex } from "viem/utils";

import { marketUSDCAddress, previewerAbi, previewerAddress } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const maturity = readContract({
  address: previewerAddress,
  functionName: "exactly",
  args: [account],
  abi: previewerAbi,
}).find(({ market }) => market === marketUSDCAddress)?.fixedBorrowPositions[0]?.maturity;
if (maturity === undefined) throw new Error("no debt");

anvil("anvil_mine", [
  1,
  Number(maturity + 86_400n - hexToBigInt(anvil("eth_getBlockByNumber", ["latest", false]).timestamp)),
]);
