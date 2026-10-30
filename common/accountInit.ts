import { encodeFunctionData, hexToBigInt, zeroAddress, type Hash } from "viem";

import { exaAccountFactoryAbi } from "./generated/chain";

export default function accountInit({ salt = zeroAddress, x, y }: { salt?: string; x: Hash; y: Hash }) {
  return encodeFunctionData({
    abi: exaAccountFactoryAbi,
    functionName: "createAccount",
    args: [BigInt(salt), [{ x: hexToBigInt(x), y: hexToBigInt(y) }]],
  });
}
