import { ponder } from "ponder:registry";
import { accounts, plugins } from "ponder:schema";

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
