import { erc20Abi, keccak256, maxUint256, parseAbi, sliceHex, toHex } from "viem";
import { isHex } from "viem/utils";

import {
  auditorAbi,
  auditorAddress,
  marketAbi,
  marketUSDCAddress,
  marketWETHAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";

import { readContract, writeContract } from "../anvil";

declare const account: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const feedAbi = parseAbi([
  "function phaseId() view returns (uint16)",
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function push(uint16 phase, uint256 timestamp, int256 answer)",
]);
const priceFeed = readContract({
  address: auditorAddress,
  abi: auditorAbi,
  functionName: "markets",
  args: [marketWETHAddress],
})[4];
const phase = readContract({ address: priceFeed, abi: feedAbi, functionName: "phaseId" });
const [, price, , timestamp] = readContract({ address: priceFeed, abi: feedAbi, functionName: "latestRoundData" });
const liquidator = sliceHex(keccak256(toHex("liquidator")), 12);

writeContract({ address: priceFeed, abi: feedAbi, functionName: "push", args: [phase, timestamp, (price * 3n) / 5n] });
try {
  writeContract({
    address: usdcAddress,
    abi: parseAbi(["function mint(address to, uint256 value)"]),
    functionName: "mint",
    args: [liquidator, 1000n * 10n ** 6n],
  });
  writeContract({
    address: usdcAddress,
    abi: erc20Abi,
    functionName: "approve",
    args: [marketUSDCAddress, maxUint256],
    from: liquidator,
  });
  writeContract({
    address: marketUSDCAddress,
    abi: marketAbi,
    functionName: "liquidate",
    args: [account, maxUint256, marketWETHAddress],
    from: liquidator,
  });
} finally {
  writeContract({ address: priceFeed, abi: feedAbi, functionName: "push", args: [phase, timestamp, price] });
}
