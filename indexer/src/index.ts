import { ponder } from "ponder:registry";
import { accounts, borrows, deposits, plugins, proposalManagers, proposals, repays, withdraws } from "ponder:schema";
import { getAbiItem, toFunctionSelector, type Hex } from "viem";

import { exaPluginAbi } from "@exactly/common/generated/chain";

const executeProposal = toFunctionSelector(getAbiItem({ abi: exaPluginAbi, name: "executeProposal" }));

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
  const account = await context.db.find(accounts, { chainId, address: event.args.owner }); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (!account) return;
  const plugin =
    account.owner === event.args.receiver.toLowerCase() ||
    !!(await context.db.find(plugins, { chainId, account: account.address, address: event.args.receiver })); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const proposalManager =
    plugin && event.transaction.input.startsWith(executeProposal)
      ? await context.db.find(proposalManagers, { chainId, plugin: event.args.receiver }) // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
      : null;
  await context.db.insert(withdraws).values({
    ...log(event, context),
    account: event.args.owner,
    caller: event.args.caller,
    receiver: event.args.receiver,
    market: event.log.address,
    assets: event.args.assets,
    input: plugin ? event.transaction.input : null,
    proposalManager: proposalManager?.address ?? null,
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
