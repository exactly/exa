import { erc20Abi, pad } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import { proposalManagerAbi, proposalManagerAddress } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity, block } from "../server";

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
const fromBlock = anvil("eth_blockNumber", []);
block(account, proposals);

while (
  readContract({ address: proposalManagerAddress, functionName: "nonces", args: [account], abi: proposalManagerAbi }) <
  nextNonce
);
const toBlock = anvil("eth_blockNumber", []);
const logs = anvil("eth_getLogs", [
  {
    fromBlock,
    toBlock,
    topics: [toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" })), null, pad(account)],
  },
]);
for (const log of logs) {
  const decimals = readContract({ address: log.address, functionName: "decimals", abi: erc20Abi });
  activity(log.address, account, Number(BigInt(log.data)) / 10 ** decimals);
}
