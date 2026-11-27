import { exaAccountFactoryAbi, exaAccountFactoryAddress } from "@exactly/common/generated/chain";

import { readContract, writeContract } from "../anvil";

declare const output: { exa: string };

const args = [0n, [{ x: 1n, y: 0n }]] as const;

output.exa = readContract({
  address: exaAccountFactoryAddress,
  abi: exaAccountFactoryAbi,
  functionName: "getAddress",
  args,
});
writeContract({ address: exaAccountFactoryAddress, abi: exaAccountFactoryAbi, functionName: "createAccount", args });
