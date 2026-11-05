import { ponder } from "ponder:registry";
import {
  accounts,
  borrows,
  collectors,
  delays,
  deposits,
  executions,
  plugins,
  proposalManagers,
  proposals,
  repays,
  withdraws,
} from "ponder:schema";
import { decodeFunctionData, getAbiItem, toFunctionSelector, type Hex } from "viem";

import { exaPluginAbi } from "@exactly/common/generated/chain";

const executeProposalAbi = [getAbiItem({ abi: exaPluginAbi, name: "executeProposal" })] as const;
const executeProposal = toFunctionSelector(executeProposalAbi[0]);
const legacyWithdraw = toFunctionSelector("withdraw()");

ponder.on("ExaAccountFactory:ExaAccountInitialized", async ({ event, context }) => {
  await context.db.insert(accounts).values({
    chainId: context.chain.id,
    address: event.args.account,
    factory: event.log.address,
    block: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on("ExaAccount:PluginInstalled", async ({ event, context }) => {
  const key = { chainId: context.chain.id, address: event.log.address };
  const account = await context.db.find(accounts, key); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (account?.block === event.block.number && !account.owner) {
    await context.db.update(accounts, key).set({ owner: event.args.plugin });
    return;
  }
  await context.db
    .insert(plugins)
    .values({
      chainId: context.chain.id,
      account: event.log.address,
      address: event.args.plugin,
      block: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
});

ponder.on("ExaPlugin:ProposalManagerSet", async ({ event, context }) => {
  await context.db
    .insert(proposalManagers)
    .values({ chainId: context.chain.id, plugin: event.log.address, address: event.args.proposalManager })
    .onConflictDoUpdate({ address: event.args.proposalManager });
});

ponder.on("ExaPlugin:CollectorSet", async ({ event, context }) => {
  const position = { block: event.block.number, logIndex: event.log.logIndex };
  await context.db
    .insert(collectors)
    .values({ chainId: context.chain.id, plugin: event.log.address, address: event.args.collector, ...position })
    .onConflictDoUpdate(position);
});

ponder.on("ProposalManager:DelaySet", async ({ event, context }) => {
  await context.db
    .insert(delays)
    .values({ chainId: context.chain.id, proposalManager: event.log.address, delay: event.args.delay })
    .onConflictDoUpdate({ delay: event.args.delay });
});

ponder.on("Market:Deposit", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.owner }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(deposits).values({
    ...log(event, context),
    account: event.args.owner,
    caller: event.args.caller,
    market: event.log.address,
    assets: event.args.assets,
  });
});

ponder.on("Market:Withdraw", async ({ event, context }) => {
  const chainId = context.chain.id;
  if (!(await context.db.find(accounts, { chainId, address: event.args.owner }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const manager = await context.db.find(proposalManagers, { chainId, plugin: event.args.receiver }); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const executed = manager && (await context.db.find(executions, { chainId, account: event.args.owner })); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const { hash, input } = event.transaction;
  const proposal =
    manager && executed?.hash === hash && executed.proposalManager === manager.address
      ? executed
      : manager && input.startsWith(executeProposal)
        ? {
            proposalManager: manager.address,
            nonce: decodeFunctionData({ abi: executeProposalAbi, data: input }).args[0],
          }
        : null;
  await context.db.insert(withdraws).values({
    ...log(event, context),
    account: event.args.owner,
    caller: event.args.caller,
    receiver: event.args.receiver,
    market: event.log.address,
    assets: event.args.assets,
    proposalManager: input.startsWith(legacyWithdraw) ? event.args.receiver : (proposal?.proposalManager ?? null),
    nonce: proposal?.nonce ?? null,
  });
});

ponder.on("Market:BorrowAtMaturity", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.borrower }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(borrows).values({
    ...log(event, context),
    account: event.args.borrower,
    caller: event.args.caller,
    receiver: event.args.receiver,
    market: event.log.address,
    maturity: event.args.maturity,
    assets: event.args.assets,
    fee: event.args.fee,
  });
});

ponder.on("Market:RepayAtMaturity", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.borrower }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(repays).values({
    ...log(event, context),
    account: event.args.borrower,
    caller: event.args.caller,
    market: event.log.address,
    maturity: event.args.maturity,
    assets: event.args.assets,
    positionAssets: event.args.positionAssets,
  });
});

ponder.on("ProposalManager:Proposed", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.account }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(proposals).values({
    ...log(event, context),
    account: event.args.account,
    proposalManager: event.log.address,
    nonce: event.args.nonce,
    market: event.args.market,
    proposalType: event.args.proposalType,
    amount: event.args.amount,
    data: event.args.data,
    unlock: event.args.unlock,
  });
});

ponder.on("ProposalManager:ProposalNonceSet", async ({ event, context }) => {
  if (!event.args.executed) return;
  const key = { chainId: context.chain.id, account: event.args.account };
  if (!(await context.db.find(accounts, { chainId: key.chainId, address: key.account }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const execution = { proposalManager: event.log.address, nonce: event.args.nonce - 1n, hash: event.transaction.hash };
  await context.db
    .insert(executions)
    .values({ ...key, ...execution })
    .onConflictDoUpdate(execution);
});

function log(
  {
    id,
    block,
    transaction,
    log: { logIndex },
  }: {
    block: { number: bigint; timestamp: bigint };
    id: string;
    log: { logIndex: number };
    transaction: { hash: Hex; transactionIndex: number };
  },
  { chain }: { chain: { id: number } },
) {
  return {
    id,
    chainId: chain.id,
    hash: transaction.hash,
    block: block.number,
    timestamp: block.timestamp,
    transactionIndex: transaction.transactionIndex,
    logIndex,
  };
}
