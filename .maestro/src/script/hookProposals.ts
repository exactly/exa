import { proposalManagerAbi, proposalManagerAddress } from "@exactly/common/generated/chain";
import { isHex } from "viem/utils";

import anvil, { readContract } from "../anvil";
import { block } from "../server";

declare const account: string | undefined;
declare const count: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");

const proposalDelay = readContract({ address: proposalManagerAddress, functionName: "delay", abi: proposalManagerAbi });
const nextNonce = readContract({
  address: proposalManagerAddress,
  functionName: "queueNonces",
  args: [account],
  abi: proposalManagerAbi,
});
const length = Number(count ?? "1");
const proposals = Array.from({ length }, (_, index) => {
  const nonce = nextNonce - BigInt(length - index);
  const [amount, market, timestamp, proposalType, data] = readContract({
    address: proposalManagerAddress,
    functionName: "proposals",
    args: [account, nonce],
    abi: proposalManagerAbi,
  });
  return { nonce, amount, market, proposalType, data, unlock: timestamp + proposalDelay };
});

anvil("anvil_mine", [1, Number(proposalDelay)]);
block(account, proposals);
