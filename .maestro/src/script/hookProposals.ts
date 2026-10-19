import { encodeDeployData, erc20Abi, pad, type Address } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import {
  auditorAddress,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketUSDCAddress,
  proposalManagerAbi,
  proposalManagerAddress,
} from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity, block } from "../server";

declare const account: string | undefined;
declare const count: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");

const proposalDelay = readContract({ address: proposalManagerAddress, functionName: "delay", abi: proposalManagerAbi });
let proposals = pending(account);
for (const deadline = Date.now() + 30_000; proposals.length < Number(count ?? "1"); proposals = pending(account)) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for queued proposals");
}

anvil("anvil_mine", [1, Number(proposalDelay)]);
const fromBlock = anvil("eth_blockNumber", []);
block(account, proposals);

for (
  const deadline = Date.now() + 30_000;
  readContract({ address: proposalManagerAddress, functionName: "nonces", args: [account], abi: proposalManagerAbi }) <
  (proposals[0]?.nonce ?? 0n) + BigInt(proposals.length);
) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for proposals");
}
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

function pending(address: Address) {
  return readContract({
    code: encodeDeployData({
      abi: exaPreviewerAbi,
      bytecode: exaPreviewerCode,
      args: [auditorAddress, marketUSDCAddress, proposalManagerAddress],
    }),
    functionName: "pendingProposals",
    args: [address],
    abi: exaPreviewerAbi,
  }).map(({ nonce, proposal }) => ({ ...proposal, nonce, unlock: 0n }));
}
