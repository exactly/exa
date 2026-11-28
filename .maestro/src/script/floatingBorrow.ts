import { erc20Abi, keccak256, maxUint256, parseAbi, sliceHex, toHex } from "viem";
import { parseUnits } from "viem/utils";

import {
  auditorAbi,
  auditorAddress,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";

import { writeContract } from "../anvil";

declare const amount: string | undefined;

if (!amount || Number.isNaN(Number(amount))) throw new Error("bad amount");

const borrower = sliceHex(keccak256(toHex(String(Math.random()))), 12);
const collateral = 1000n * 10n ** 6n;

writeContract({
  address: usdcAddress,
  abi: parseAbi(["function mint(address to, uint256 value)"]),
  functionName: "mint",
  args: [borrower, collateral],
});
writeContract({
  address: usdcAddress,
  abi: erc20Abi,
  functionName: "approve",
  args: [marketUSDCAddress, maxUint256],
  from: borrower,
});
writeContract({
  address: marketUSDCAddress,
  abi: marketAbi,
  functionName: "deposit",
  args: [collateral, borrower],
  from: borrower,
});
writeContract({
  address: auditorAddress,
  abi: auditorAbi,
  functionName: "enterMarket",
  args: [marketUSDCAddress],
  from: borrower,
});
writeContract({
  address: marketWETHAddress,
  abi: marketAbi,
  functionName: "borrow",
  args: [parseUnits(amount, 18), borrower, borrower],
  from: borrower,
});
