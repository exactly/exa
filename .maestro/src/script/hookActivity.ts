import { erc20Abi, formatUnits, parseEventLogs, type Address } from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";
import { encodeEventTopics, isAddress, isHex } from "viem/utils";

import { marketAbi } from "@exactly/common/generated/chain";

import anvil, { readContract } from "../anvil";
import { activity } from "../server";

declare const account: string | undefined;
declare const amount: string | undefined;
declare const asset: string | undefined;
declare const receiver: string | undefined;
declare const repay: string | undefined;

if (!account || !isHex(account)) throw new Error("bad account");
if (receiver !== undefined && !isAddress(receiver)) throw new Error("bad receiver");
if (receiver !== undefined && !amount) throw new Error("bad amount");
if (receiver !== undefined && !asset) throw new Error("bad asset");

const operation = anvil("eth_getLogs", [
  {
    address: entryPoint06Address,
    fromBlock: "0x0",
    topics: encodeEventTopics({ abi: entryPoint06Abi, eventName: "UserOperationEvent", args: { sender: account } }),
  },
]).pop();
if (!operation?.transactionHash) throw new Error("no user operation");
const logs = anvil("eth_getTransactionReceipt", [operation.transactionHash])?.logs ?? [];

if (receiver) {
  const [sent, ...rest] = transfers({ from: account, to: receiver });
  if (
    !sent ||
    rest.length > 0 ||
    symbol(sent.address) !== asset ||
    formatUnits(sent.args.value, decimals(sent.address)) !== amount
  ) {
    throw new Error(`expected one ${amount} ${asset} transfer to ${receiver}`);
  }
}
if (repay) {
  if (!transfers({ from: account }).some(({ address }) => symbol(address) === repay))
    throw new Error(`no ${repay} spent`);
  const [repaid] = parseEventLogs({ abi: marketAbi, eventName: "RepayAtMaturity", args: { borrower: account }, logs });
  if (!repaid) throw new Error("no repay");
  const [principal, fee] = readContract({
    address: repaid.address,
    functionName: "fixedBorrowPositions",
    args: [repaid.args.maturity, account],
    abi: marketAbi,
  });
  if (principal + fee !== 0n) throw new Error(`debt left: ${principal + fee}`);
}
for (const { address, args, transactionHash } of transfers({ to: account })) {
  activity(address, account, Number(formatUnits(args.value, decimals(address))), transactionHash);
}

function transfers(args: { from?: Address; to?: Address }) {
  return parseEventLogs({ abi: erc20Abi, eventName: "Transfer", args, logs });
}

function symbol(address: Address) {
  return readContract({ address, functionName: "symbol", abi: erc20Abi });
}

function decimals(address: Address) {
  return readContract({ address, functionName: "decimals", abi: erc20Abi });
}
