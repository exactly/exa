import {
  decodeEventLog,
  encodeEventTopics,
  erc20Abi,
  erc4626Abi,
  formatUnits,
  keccak256,
  pad,
  slice,
  toBytes,
  type Address,
} from "viem";
import { getAbiItem, isAddress, isHex, toEventSelector } from "viem/utils";

import {
  appPreviewerAbi,
  appPreviewerCode,
  exaPluginAbi,
  marketAbi,
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
declare const network: string | undefined;
declare const output: { redeemed?: string; sent?: string };
declare const receiver: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (count !== undefined && !(Number.isSafeInteger(Number(count)) && Number(count) > 0)) throw new Error("bad count");
if (receiver !== undefined && !isAddress(receiver)) throw new Error("bad receiver");
if ((receiver ?? beneficiary) !== undefined && !amount && !max) throw new Error("bad amount");

const [plugin] = readContract(
  {
    address: account,
    functionName: "getInstalledPlugins",
    abi: upgradeableModularAccountAbi,
  },
  network,
);
if (!plugin) throw new Error("no plugin");
const proposalManager = readContract({ address: plugin, functionName: "proposalManager", abi: exaPluginAbi }, network);
const proposalDelay = readContract(
  { address: proposalManager, functionName: "delay", abi: proposalManagerAbi },
  network,
);
let proposals = pending(account);
for (const deadline = Date.now() + 30_000; proposals.length < Number(count ?? "1"); proposals = pending(account)) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for queued proposals");
}
if (market !== undefined) {
  const expected = `exa${market === "ETH" ? "WETH" : market}`;
  const markets = proposals
    .map(({ market: address }) => readContract({ address, functionName: "symbol", abi: erc20Abi }, network))
    .join(", ");
  if (markets !== expected) throw new Error(`expected ${expected} proposal, got [${markets}]`);
}

const deposit =
  max && proposals.some(({ market: address }) => address === marketUSDCAddress)
    ? readContract(
        {
          address: marketUSDCAddress,
          functionName: "convertToAssets",
          abi: erc4626Abi,
          args: [
            readContract(
              { address: marketUSDCAddress, functionName: "balanceOf", abi: erc20Abi, args: [account] },
              network,
            ),
          ],
        },
        network,
      )
    : 0n;
const accrual = max ? 86_400 : 0;
anvil("anvil_mine", [1, Number(proposalDelay) + accrual], network);
const fromBlock = anvil("eth_blockNumber", [], network);

const nonceSet = encodeEventTopics({
  abi: proposalManagerAbi,
  eventName: "ProposalNonceSet",
  args: { account, nonce: (proposals[0]?.nonce ?? 0n) + BigInt(proposals.length) },
});
let toBlock = anvil("eth_blockNumber", [], network);
for (
  const deadline = Date.now() + 60_000 + Number(proposalDelay) * 1000;
  anvil("eth_getLogs", [{ address: proposalManager, fromBlock, toBlock, topics: nonceSet }], network).length === 0;
  toBlock = anvil("eth_blockNumber", [], network)
) {
  if (Date.now() >= deadline) throw new Error("timeout waiting for proposals");
}
let redeemed: string | undefined;
if (max) {
  const withdraw = toEventSelector(getAbiItem({ abi: marketAbi, name: "Withdraw" }));
  for (const { market: address } of proposals) {
    const shares = readContract({ address, functionName: "balanceOf", abi: erc20Abi, args: [account] }, network);
    if (shares !== 0n) throw new Error(`expected no shares left in ${address}, got ${shares}`);
    const decimals = readContract({ address, functionName: "decimals", abi: erc20Abi }, network);
    for (const log of anvil(
      "eth_getLogs",
      [{ address, fromBlock, toBlock, topics: [withdraw, null, null, pad(account)] }],
      network,
    )) {
      const { args } = decodeEventLog({ abi: marketAbi, eventName: "Withdraw", data: log.data, topics: log.topics });
      if (args.assets === args.shares) throw new Error(`expected redeemed assets apart from shares in ${address}`);
      const scale = 10n ** BigInt(Math.max(decimals - 8, 0));
      redeemed = formatUnits(((args.assets + scale / 2n) / scale) * scale, decimals);
      output.redeemed = redeemed;
    }
  }
}
const transfer = toEventSelector(getAbiItem({ abi: erc20Abi, name: "Transfer" }));
const logs = anvil("eth_getLogs", [{ fromBlock, toBlock, topics: [transfer, null, pad(account)] }], network);
for (const log of logs) {
  const decimals = readContract({ address: log.address, functionName: "decimals", abi: erc20Abi }, network);
  activity(log.address, account, Number(BigInt(log.data)) / 10 ** decimals, undefined, network);
}
const to = receiver ?? (beneficiary && slice(keccak256(toBytes(JSON.stringify(JSON.parse(beneficiary)))), 12));
if (to) {
  const received = anvil(
    "eth_getLogs",
    [{ address: usdcAddress, fromBlock, toBlock, topics: [transfer, null, pad(to)] }],
    network,
  ).reduce((total, { data }) => total + BigInt(data), 0n);
  const withdrawn = formatUnits(received, 6);
  if (max ? received < deposit : withdrawn !== amount) {
    const expected = max ? `at least ${formatUnits(deposit, 6)}` : amount;
    throw new Error(`expected ${expected} usdc to ${receiver ?? beneficiary}, got ${withdrawn}`);
  }
  output.sent = redeemed ?? withdrawn;
}

function pending(address: Address) {
  return readContract(
    {
      code: appPreviewerCode,
      functionName: "pendingProposals",
      args: [address],
      abi: appPreviewerAbi,
    },
    network,
  ).map(({ nonce, proposal }) => ({ ...proposal, nonce, unlock: 0n }));
}
