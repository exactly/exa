import {
  encodeDeployData,
  encodeEventTopics,
  erc20Abi,
  formatUnits,
  keccak256,
  pad,
  slice,
  toBytes,
  type Address,
} from "viem";
import { getAbiItem, isAddress, isHex, toEventSelector } from "viem/utils";

import {
  auditorAddress,
  exaPluginAbi,
  exaPreviewerAbi,
  exaPreviewerCode,
  marketUSDCAddress,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity, block } from "../server";

declare const account: string | undefined;
declare const amount: string | undefined;
declare const beneficiary: string | undefined;
declare const count: string | undefined;
declare const market: string | undefined;
declare const receiver: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");
if (receiver !== undefined && !isAddress(receiver)) throw new Error("bad receiver");
if ((receiver ?? beneficiary) !== undefined && !amount) throw new Error("bad amount");

const [plugin] = readContract({
  address: account,
  functionName: "getInstalledPlugins",
  abi: upgradeableModularAccountAbi,
});
if (!plugin) throw new Error("no plugin");
const proposalManager = readContract({ address: plugin, functionName: "proposalManager", abi: exaPluginAbi });
const proposalDelay = readContract({ address: proposalManager, functionName: "delay", abi: proposalManagerAbi });
let proposals = pending(account);
for (const deadline = Date.now() + 30_000; proposals.length < Number(count ?? "1"); proposals = pending(account)) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for queued proposals");
}
if (market !== undefined) {
  const expected = `exa${market === "ETH" ? "WETH" : market}`;
  const markets = proposals
    .map(({ market: address }) => readContract({ address, functionName: "symbol", abi: erc20Abi }))
    .join(", ");
  if (markets !== expected) throw new Error(`expected ${expected} proposal, got [${markets}]`);
}

anvil("anvil_mine", [1, Number(proposalDelay)]);
const fromBlock = anvil("eth_blockNumber", []);
block(account, proposals);

const nonceSet = encodeEventTopics({
  abi: proposalManagerAbi,
  eventName: "ProposalNonceSet",
  args: { account, nonce: (proposals[0]?.nonce ?? 0n) + BigInt(proposals.length) },
});
let toBlock = anvil("eth_blockNumber", []);
for (
  const deadline = Date.now() + 30_000;
  anvil("eth_getLogs", [{ address: proposalManager, fromBlock, toBlock, topics: nonceSet }]).length === 0;
  toBlock = anvil("eth_blockNumber", [])
) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for proposals");
}
const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }));
const logs = anvil("eth_getLogs", [{ fromBlock, toBlock, topics: [transfer, null, pad(account)] }]);
for (const log of logs) {
  const decimals = readContract({ address: log.address, functionName: "decimals", abi: erc20Abi });
  activity(log.address, account, Number(BigInt(log.data)) / 10 ** decimals);
}
const to = receiver ?? (beneficiary && slice(keccak256(toBytes(JSON.stringify(JSON.parse(beneficiary)))), 12));
if (to) {
  const withdrawn = formatUnits(
    anvil("eth_getLogs", [{ address: usdcAddress, fromBlock, toBlock, topics: [transfer, null, pad(to)] }]).reduce(
      (total, { data }) => total + BigInt(data),
      0n,
    ),
    6,
  );
  if (withdrawn !== amount) throw new Error(`expected ${amount} usdc to ${receiver ?? beneficiary}, got ${withdrawn}`);
}

function pending(address: Address) {
  return readContract({
    code: encodeDeployData({
      abi: exaPreviewerAbi,
      bytecode: exaPreviewerCode,
      args: [auditorAddress, marketUSDCAddress],
    }),
    functionName: "pendingProposals",
    args: [address],
    abi: exaPreviewerAbi,
  }).map(({ nonce, proposal }) => ({ ...proposal, nonce, unlock: 0n }));
}
