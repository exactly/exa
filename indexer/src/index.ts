import { ponder } from "ponder:registry";
import { accounts, borrows, deposits, plugins, proposals, repays, withdraws } from "ponder:schema";
import { getAbiItem, toFunctionSelector, type Hex } from "viem";

import { exaPluginAbi } from "@exactly/common/generated/chain";

const executeProposal = toFunctionSelector(getAbiItem({ abi: exaPluginAbi, name: "executeProposal" }));

ponder.on("ExaAccountFactory:ExaAccountInitialized", async ({ event, context }) => {
  await context.db.insert(accounts).values({
    address: event.args.account,
    factory: event.log.address,
    block: event.block.number,
    timestamp: event.block.timestamp,
  });
});

ponder.on("ExaAccount:PluginInstalled", async ({ event, context }) => {
  const account = await context.db.find(accounts, { address: event.log.address }); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (account?.block === event.block.number && !account.owner) {
    await context.db.update(accounts, { address: event.log.address }).set({ owner: event.args.plugin });
    return;
  }
  await context.db
    .insert(plugins)
    .values({
      account: event.log.address,
      address: event.args.plugin,
      block: event.block.number,
      timestamp: event.block.timestamp,
    })
    .onConflictDoNothing();
});

ponder.on("Market:Deposit", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { address: event.args.owner }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(deposits).values({
    ...log(event),
    account: event.args.owner,
    caller: event.args.caller,
    market: event.log.address,
    assets: event.args.assets,
  });
});

ponder.on("Market:Withdraw", async ({ event, context }) => {
  const account = await context.db.find(accounts, { address: event.args.owner }); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (!account) return;
  const plugin =
    account.owner === event.args.receiver.toLowerCase() ||
    !!(await context.db.find(plugins, { account: account.address, address: event.args.receiver })); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(withdraws).values({
    ...log(event),
    account: event.args.owner,
    caller: event.args.caller,
    receiver: event.args.receiver,
    market: event.log.address,
    assets: event.args.assets,
    input: plugin ? event.transaction.input : null,
    manager:
      plugin && event.transaction.input.startsWith(executeProposal)
        ? await context.client.readContract({
            address: event.args.receiver,
            abi: exaPluginAbi,
            functionName: "proposalManager",
          })
        : null,
  });
});

ponder.on("Market:BorrowAtMaturity", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { address: event.args.borrower }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(borrows).values({
    ...log(event),
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
  if (!(await context.db.find(accounts, { address: event.args.borrower }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(repays).values({
    ...log(event),
    account: event.args.borrower,
    caller: event.args.caller,
    market: event.log.address,
    maturity: event.args.maturity,
    assets: event.args.assets,
    positionAssets: event.args.positionAssets,
  });
});

ponder.on("ProposalManager:Proposed", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { address: event.args.account }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(proposals).values({
    ...log(event),
    account: event.args.account,
    manager: event.log.address,
    nonce: event.args.nonce,
    market: event.args.market,
    proposalType: event.args.proposalType,
    amount: event.args.amount,
    data: event.args.data,
    unlock: event.args.unlock,
  });
});

function log({
  id,
  block,
  transaction,
  log: { logIndex },
}: {
  block: { number: bigint; timestamp: bigint };
  id: string;
  log: { logIndex: number };
  transaction: { hash: Hex; transactionIndex: number };
}) {
  return {
    id,
    hash: transaction.hash,
    block: block.number,
    timestamp: block.timestamp,
    transactionIndex: transaction.transactionIndex,
    logIndex,
  };
}
