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
  executions,
  markets,
  plugins,
  proposalManagers,
  proposals,
  repays,
  swaps,
  tokens,
  withdraws,
} from "ponder:schema";
import {
  BaseError,
  CallExecutionError,
  ContractFunctionRevertedError,
  ContractFunctionZeroDataError,
  decodeFunctionData,
  erc20Abi,
  erc20Abi_bytes32,
  getAbiItem,
  hexToString,
  isAddressEqual,
  numberToHex,
  parseEventLogs,
  toFunctionSelector,
  zeroAddress,
  type Hex,
} from "viem";
import { entryPoint06Abi, entryPoint06Address } from "viem/account-abstraction";

import deriveAddress from "@exactly/common/deriveAddress";
import exaChain, {
  alchemyChains,
  auditorAbi,
  chains,
  exaPluginAbi,
  factories,
  marketAbi,
} from "@exactly/common/generated/chain";

const executeProposalAbi = [getAbiItem({ abi: exaPluginAbi, name: "executeProposal" })] as const;
const executeProposal = toFunctionSelector(executeProposalAbi[0]);
const legacyWithdraw = toFunctionSelector("withdraw()");
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

ponder.on(
  "WebauthnOwnerPlugin:OwnerUpdated(address indexed account, (uint256 x, uint256 y)[] addedOwners, (uint256 x, uint256 y)[] removedOwners)",
  async ({ event, context }) => {
    const [owner] = event.args.addedOwners;
    const key = { chainId: context.chain.id, address: event.args.account };
    if (!owner || (await context.db.find(accounts, key))) return; // eslint-disable-line unicorn/no-array-method-this-argument -- ponder store
    const x = numberToHex(owner.x, { size: 32 });
    const y = numberToHex(owner.y, { size: 32 });
    const factory = factories.legacy.find((address) => isAddressEqual(deriveAddress(address, { x, y }), key.address));
    if (!factory) return;
    await context.db
      .insert(accounts)
      .values({ ...key, factory, block: event.block.number, timestamp: event.block.timestamp });
  },
);

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
    usdPrice: await usdPrice(context, event.log.address),
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
    sender(context, event.transaction, event.log, bridgeData.sendingAssetId),
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
  { hash, to }: { hash: Hex; to: Hex | null },
  { address, logIndex }: { address: Hex; logIndex: number },
  asset: Hex,
) {
  if (!chains.has(context.chain.id)) return null;
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
    ...(to ? [to] : []),
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
  const auditor = chains.get(context.chain.id)?.auditor;
  if (!found?.priceFeed || !auditor) return null;
  return context.client
    .readContract({ address: auditor, abi: auditorAbi, functionName: "assetPrice", args: [found.priceFeed] })
    .catch(fallback(() => null));
}

function fallback<T>(value: () => T) {
  return (error: unknown) => {
    const found =
      error instanceof BaseError &&
      error.walk(
        (cause) =>
          cause instanceof ContractFunctionRevertedError ||
          cause instanceof ContractFunctionZeroDataError ||
          cause instanceof CallExecutionError,
      );
    if (found === false || found instanceof CallExecutionError) throw error;
    return value();
  };
}

async function assetPrice(context: Context, asset: Hex) {
  const [market] = await context.db.sql
    .select({ address: markets.address })
    .from(markets)
    .where(
      and(
        eq(markets.chainId, context.chain.id),
        asset === zeroAddress || asset.toLowerCase() === native
          ? eq(markets.symbol, "WETH")
          : eq(markets.asset, asset.toLowerCase() as Hex),
      ),
    )
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
    await context.db
      .insert(tokens)
      .values({ ...key, symbol, decimals })
      .onConflictDoNothing();
    return;
  }
  const [symbol, decimals] = await Promise.all([
    context.client
      .readContract({ address, abi: erc20Abi, functionName: "symbol" })
      .catch(
        fallback(() =>
          context.client
            .readContract({ address, abi: erc20Abi_bytes32, functionName: "symbol" })
            .then((value) => hexToString(value, { size: 32 })),
        ),
      )
      .catch(fallback(() => address)),
    context.client.readContract({ address, abi: erc20Abi, functionName: "decimals" }).catch(fallback(() => 18)),
  ]);
  await context.db
    .insert(tokens)
    .values({ ...key, symbol, decimals })
    .onConflictDoNothing();
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
