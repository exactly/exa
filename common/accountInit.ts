import { encodeFunctionData, hexToBigInt, type Hash } from "viem";

import { exaAccountFactoryAbi } from "./generated/chain";

export default function accountInit({ x, y }: { x: Hash; y: Hash }) {
  return encodeFunctionData({
    abi: exaAccountFactoryAbi,
    functionName: "createAccount",
    args: [0n, [{ x: hexToBigInt(x), y: hexToBigInt(y) }]],
  });
}
