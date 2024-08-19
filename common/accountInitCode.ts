import { type Address, concatHex, encodeFunctionData, type Hash, hexToBigInt } from "viem";

import { exaAccountFactoryAbi } from "./generated/chain";

export default function accountInitCode({ factory, x, y }: { factory: Address; x: Hash; y: Hash }) {
  return concatHex([
    factory,
    encodeFunctionData({
      abi: exaAccountFactoryAbi,
      functionName: "createAccount",
      args: [0n, [{ x: hexToBigInt(x), y: hexToBigInt(y) }]],
    }),
  ]);
}
