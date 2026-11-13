import { and, eq } from "ponder";
import { ponder, type Context } from "ponder:registry";
import {
  accounts,
  borrows,
  bridges,
  collectors,
  delays,
  deposits,
  exaPlugins,
  markets,
  plugins,
  proposalManagers,
  proposals,
  repays,
  swaps,
  tokens,
  withdraws,
} from "ponder:schema";
import { erc20Abi, getAbiItem, isAddressEqual, parseEventLogs, toFunctionSelector, zeroAddress, type Hex } from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";

import exaChain, {
  alchemyChains,
  auditorAbi,
  exaPluginAbi,
  marketAbi,
  networks,
} from "@exactly/common/generated/chain";

const executeProposal = toFunctionSelector(getAbiItem({ abi: exaPluginAbi, name: "executeProposal" }));
const integrator = "exa_app";
const native = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

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
  const chainId = context.chain.id;
  const key = { chainId, address: event.log.address };
  const account = await context.db.find(accounts, key); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (account?.block === event.block.number && !account.owner) {
    await context.db.update(accounts, key).set({ owner: event.args.plugin });
    return;
  }
  if (account?.block === event.block.number && !account.plugin) {
    await context.db.update(accounts, key).set({ plugin: event.args.plugin });
    await context.db.insert(exaPlugins).values({ chainId, address: event.args.plugin }).onConflictDoNothing();
  }
  const position = { block: event.block.number, timestamp: event.block.timestamp, logIndex: event.log.logIndex };
  await context.db
    .insert(plugins)
    .values({ chainId, account: event.log.address, address: event.args.plugin, ...position })
    .onConflictDoUpdate({ ...position, uninstalled: null });
});

ponder.on("ExaAccount:PluginUninstalled", async ({ event, context }) => {
  const key = { chainId: context.chain.id, account: event.log.address, address: event.args.plugin };
  if (!(await context.db.find(plugins, key))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.update(plugins, key).set({ uninstalled: event.block.number });
});

ponder.on("ExaPlugin:PluginAllowed", async ({ event, context }) => {
  const chainId = context.chain.id;
  if (!event.args.allowed || !(await context.db.find(exaPlugins, { chainId, address: event.log.address }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(exaPlugins).values({ chainId, address: event.args.plugin }).onConflictDoNothing();
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

ponder.on("Auditor:MarketListed", async ({ event, context }) => {
  const [asset, symbol] = await Promise.all([
    context.client.readContract({ address: event.args.market, abi: marketAbi, functionName: "asset" }),
    context.client.readContract({ address: event.args.market, abi: marketAbi, functionName: "symbol" }),
  ]);
  const metadata = { asset, symbol: symbol.slice(3), decimals: event.args.decimals };
  await context.db
    .insert(markets)
    .values({ chainId: context.chain.id, address: event.args.market, ...metadata })
    .onConflictDoUpdate(metadata);
});

ponder.on("Auditor:PriceFeedSet", async ({ event, context }) => {
  const key = { chainId: context.chain.id, address: event.args.market };
  if (!(await context.db.find(markets, key))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.update(markets, key).set({ priceFeed: event.args.priceFeed });
});

ponder.on("Market:Deposit", async ({ event, context }) => {
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.owner }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  await context.db.insert(deposits).values({
    ...log(event, context),
    account: event.args.owner,
    caller: event.args.caller,
    market: event.log.address,
    assets: event.args.assets,
    usdPrice: await usdPrice(context, event.log.address),
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
    usdPrice: await usdPrice(context, event.log.address),
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
    usdPrice: await usdPrice(context, event.log.address),
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
    usdPrice: await usdPrice(context, event.log.address),
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

ponder.on("Swapper:LiFiGenericSwapCompleted", async ({ event, context }) => {
  if (event.args.integrator !== integrator) return;
  if (!(await context.db.find(accounts, { chainId: context.chain.id, address: event.args.receiver }))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const [fromUsdPrice, toUsdPrice] = await Promise.all([
    assetPrice(context, event.args.fromAssetId),
    assetPrice(context, event.args.toAssetId),
    token(context, event.args.fromAssetId),
    token(context, event.args.toAssetId),
  ]);
  await context.db.insert(swaps).values({
    ...log(event, context),
    account: event.args.receiver,
    transactionId: event.args.transactionId,
    fromAsset: event.args.fromAssetId,
    toAsset: event.args.toAssetId,
    fromAmount: event.args.fromAmount,
    toAmount: event.args.toAmount,
    fromUsdPrice,
    toUsdPrice,
  });
});

ponder.on("Swapper:LiFiTransferStarted", async ({ event, context }) => {
  const { bridgeData } = event.args;
  if (bridgeData.integrator !== integrator) return;
  const [account, usd] = await Promise.all([
    sender(context, event.transaction.hash, event.log, bridgeData.sendingAssetId),
    assetPrice(context, bridgeData.sendingAssetId),
    token(context, bridgeData.sendingAssetId),
  ]);
  await context.db.insert(bridges).values({
    ...log(event, context),
    account,
    transactionId: bridgeData.transactionId,
    bridge: bridgeData.bridge,
    asset: bridgeData.sendingAssetId,
    amount: bridgeData.minAmount,
    receiver: bridgeData.receiver,
    destinationChainId: bridgeData.destinationChainId,
    usdPrice: usd,
  });
});

async function sender(
  context: Context,
  hash: Hex,
  { address, logIndex }: { address: Hex; logIndex: number },
  asset: Hex,
) {
  if (!networks.has(context.chain.id)) return null;
  const { logs } = await context.client.getTransactionReceipt({ hash });
  const operations = parseEventLogs({
    abi: entryPoint06Abi,
    eventName: "UserOperationEvent",
    logs: logs.filter((entry) => isAddressEqual(entry.address, entryPoint06Address)),
  });
  const operation = operations.find((userOperation) => userOperation.logIndex > logIndex);
  const floor = Math.max(
    -1,
    ...operations.map((userOperation) => userOperation.logIndex).filter((index) => index < logIndex),
  );
  const candidates = [
    ...(operation ? [operation.args.sender] : []),
    ...parseEventLogs({
      abi: erc20Abi,
      eventName: "Transfer",
      logs: logs.filter((entry) => isAddressEqual(entry.address, asset)),
      args: { to: address },
    })
      .filter((transfer) => transfer.logIndex > floor && transfer.logIndex < logIndex)
      .map(({ args }) => args.from),
  ];
  for (const candidate of candidates) {
    if (await context.db.find(accounts, { chainId: context.chain.id, address: candidate })) return candidate; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  }
  return null;
}

async function usdPrice(context: Context, market: Hex) {
  const found = await context.db.find(markets, { chainId: context.chain.id, address: market }); // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  const auditor = networks.get(context.chain.id)?.auditor;
  if (!found?.priceFeed || !auditor) throw new Error(`unknown market ${market}`);
  return context.client.readContract({
    address: auditor,
    abi: auditorAbi,
    functionName: "assetPrice",
    args: [found.priceFeed],
  });
}

async function assetPrice(context: Context, asset: Hex) {
  const [market] = await context.db.sql
    .select({ address: markets.address })
    .from(markets)
    .where(and(eq(markets.chainId, context.chain.id), eq(markets.asset, asset.toLowerCase() as Hex)))
    .limit(1);
  return market ? usdPrice(context, market.address) : null;
}

async function token(context: Context, address: Hex) {
  const key = { chainId: context.chain.id, address };
  if (await context.db.find(tokens, key)) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
  if (address === zeroAddress || address.toLowerCase() === native) {
    const network = context.chain.id === exaChain.id ? exaChain : alchemyChains.get(context.chain.id);
    if (!network?.nativeCurrency) throw new Error(`unknown chain ${context.chain.id}`);
    const { symbol, decimals } = network.nativeCurrency;
    await context.db.insert(tokens).values({ ...key, symbol, decimals });
    return;
  }
  const metadata = await Promise.all([
    context.client.readContract({ address, abi: erc20Abi, functionName: "symbol" }),
    context.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }),
  ]).catch(() => undefined);
  if (!metadata) return;
  const [symbol, decimals] = metadata;
  await context.db.insert(tokens).values({ ...key, symbol, decimals });
}

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
