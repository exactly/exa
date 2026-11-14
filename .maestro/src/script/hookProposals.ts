import {
  encodeEventTopics,
  erc20Abi,
  erc4626Abi,
  formatUnits,
  hexToBigInt,
  keccak256,
  pad,
  slice,
  toBytes,
  toHex,
} from "viem";
import { getAbiItem, isAddress, isHex, toEventSelector } from "viem/utils";

import {
  exaPluginAbi,
  marketUSDCAddress,
  proposalManagerAbi,
  upgradeableModularAccountAbi,
  usdcAddress,
} from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity } from "../server";

declare const account: string | undefined;
declare const amount: string | undefined;
declare const beneficiary: string | undefined;
declare const count: string | undefined;
declare const market: string | undefined;
declare const max: string | undefined;
declare const output: { proposals?: number; sent?: string };
declare const receiver: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");
if (receiver !== undefined && !isAddress(receiver)) throw new Error("bad receiver");
if ((receiver ?? beneficiary) !== undefined && !amount && !max) throw new Error("bad amount");

const [plugin] = readContract({
  address: account,
  functionName: "getInstalledPlugins",
  abi: upgradeableModularAccountAbi,
});
if (!plugin) throw new Error("no plugin");
const proposalManager = readContract({ address: plugin, functionName: "proposalManager", abi: exaPluginAbi });
const proposalDelay = readContract({ address: proposalManager, functionName: "delay", abi: proposalManagerAbi });
const queued = () =>
  readContract({ address: proposalManager, functionName: "queueNonces", abi: proposalManagerAbi, args: [account] });
const size = BigInt(count ?? "1");
for (const deadline = Date.now() + 30_000; queued() < BigInt(output.proposals ?? 0) + size; ) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for queued proposals");
}
const last = queued();
const first = last - size;
const proposals = Array.from({ length: Number(last - first) }, (_, index) => {
  const [, address] = readContract({
    address: proposalManager,
    functionName: "proposals",
    abi: proposalManagerAbi,
    args: [account, first + BigInt(index)],
  });
  return { market: address };
});
if (market !== undefined) {
  const expected = `exa${market === "ETH" ? "WETH" : market}`;
  const markets = proposals
    .map(({ market: address }) => readContract({ address, functionName: "symbol", abi: erc20Abi }))
    .join(", ");
  if (markets !== expected) throw new Error(`expected ${expected} proposal, got [${markets}]`);
}
const [proposed] = anvil("eth_getLogs", [
  {
    address: proposalManager,
    fromBlock: "0x0",
    topics: encodeEventTopics({ abi: proposalManagerAbi, eventName: "Proposed", args: { account, nonce: first } }),
  },
]);
if (!proposed?.blockNumber) throw new Error("missing proposed event");
const fromBlock = toHex(hexToBigInt(proposed.blockNumber) + 1n);
const executed = () =>
  readContract({ address: proposalManager, functionName: "nonces", abi: proposalManagerAbi, args: [account] }) >= last;

const deposit =
  max && !executed()
    ? readContract({
        address: marketUSDCAddress,
        functionName: "convertToAssets",
        abi: erc4626Abi,
        args: [readContract({ address: marketUSDCAddress, functionName: "balanceOf", abi: erc20Abi, args: [account] })],
      })
    : 0n;
if (!executed()) anvil("anvil_mine", [1, Number(proposalDelay) + (max ? 86_400 : 0)]);
for (const deadline = Date.now() + 60_000; !executed(); ) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for proposals");
}
const toBlock = anvil("eth_blockNumber", []);
output.proposals = Number(last);
if (max) {
  for (const { market: address } of proposals) {
    const shares = readContract({ address, functionName: "balanceOf", abi: erc20Abi, args: [account] });
    if (shares !== 0n) throw new Error(`expected no shares left in ${address}, got ${shares}`);
  }
}
const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }));
const logs = anvil("eth_getLogs", [{ fromBlock, toBlock, topics: [transfer, null, pad(account)] }]);
for (const log of logs) {
  const decimals = readContract({ address: log.address, functionName: "decimals", abi: erc20Abi });
  activity(log.address, account, Number(BigInt(log.data)) / 10 ** decimals);
}
const to = receiver ?? (beneficiary && slice(keccak256(toBytes(JSON.stringify(JSON.parse(beneficiary)))), 12));
if (to) {
  const received = anvil("eth_getLogs", [
    { address: usdcAddress, fromBlock, toBlock, topics: [transfer, null, pad(to)] },
  ]).reduce((total, { data }) => total + BigInt(data), 0n);
  const withdrawn = formatUnits(received, 6);
  if (max ? received < deposit : withdrawn !== amount) {
    const expected = max ? `at least ${formatUnits(deposit, 6)}` : amount;
    throw new Error(`expected ${expected} usdc to ${receiver ?? beneficiary}, got ${withdrawn}`);
  }
  output.sent = withdrawn;
}
