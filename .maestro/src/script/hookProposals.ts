import { encodeDeployData, erc20Abi, formatUnits, keccak256, pad, slice, toBytes, type Address } from "viem";
import { getAbiItem, isHex, toEventSelector } from "viem/utils";

import {
  auditorAddress,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketUSDCAddress,
  proposalManagerAbi,
  proposalManagerAddress,
  usdcAddress,
} from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity, block } from "../server";

declare const account: string | undefined;
declare const amount: string | undefined;
declare const beneficiary: string | undefined;
declare const count: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");
if (beneficiary !== undefined && !amount) throw new Error("bad amount");

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
const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }));
const logs = anvil("eth_getLogs", [{ fromBlock, toBlock, topics: [transfer, null, pad(account)] }]);
for (const log of logs) {
  const decimals = readContract({ address: log.address, functionName: "decimals", abi: erc20Abi });
  activity(log.address, account, Number(BigInt(log.data)) / 10 ** decimals);
}
if (beneficiary !== undefined) {
  const withdrawn = anvil("eth_getLogs", [
    {
      address: usdcAddress,
      fromBlock,
      toBlock,
      topics: [transfer, null, pad(slice(keccak256(toBytes(JSON.stringify(JSON.parse(beneficiary)))), 12))],
    },
  ])
    .map(({ data }) => formatUnits(BigInt(data), 6))
    .join(", ");
  if (withdrawn !== amount) throw new Error(`expected ${amount} usdc to ${beneficiary}, got [${withdrawn}]`);
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
