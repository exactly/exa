import { index, onchainTable, primaryKey, type PgColumnsBuilders } from "ponder";

export const accounts = onchainTable(
  "accounts",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    factory: t.hex().notNull(),
    owner: t.hex(),
    plugin: t.hex(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
);

export const plugins = onchainTable(
  "plugins",
  (t) => ({
    chainId: t.integer().notNull(),
    account: t.hex().notNull(),
    address: t.hex().notNull(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
    uninstalled: t.bigint(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.account, table.address] }) }),
);

export const exaPlugins = onchainTable(
  "exa_plugins",
  (t) => ({ chainId: t.integer().notNull(), address: t.hex().notNull() }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
);

export const proposalManagers = onchainTable(
  "proposal_managers",
  (t) => ({ chainId: t.integer().notNull(), plugin: t.hex().notNull(), address: t.hex().notNull() }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.plugin] }) }),
);

export const collectors = onchainTable(
  "collectors",
  (t) => ({
    chainId: t.integer().notNull(),
    plugin: t.hex().notNull(),
    address: t.hex().notNull(),
    block: t.bigint().notNull(),
    logIndex: t.integer().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.plugin, table.address] }) }),
);

export const delays = onchainTable(
  "delays",
  (t) => ({ chainId: t.integer().notNull(), proposalManager: t.hex().notNull(), delay: t.bigint().notNull() }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.proposalManager] }) }),
);

export const markets = onchainTable(
  "markets",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    asset: t.hex().notNull(),
    symbol: t.text().notNull(),
    decimals: t.integer().notNull(),
    priceFeed: t.hex(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
);

export const tokens = onchainTable(
  "tokens",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    symbol: t.text().notNull(),
    decimals: t.integer().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.address] }) }),
);

export const deposits = onchainTable(
  "deposits",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    caller: t.hex().notNull(),
    market: t.hex().notNull(),
    assets: t.bigint().notNull(),
    usdPrice: t.bigint().notNull(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const withdraws = onchainTable(
  "withdraws",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    caller: t.hex().notNull(),
    receiver: t.hex().notNull(),
    market: t.hex().notNull(),
    assets: t.bigint().notNull(),
    usdPrice: t.bigint().notNull(),
    input: t.hex(),
    proposalManager: t.hex(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const borrows = onchainTable(
  "borrows",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    caller: t.hex().notNull(),
    receiver: t.hex().notNull(),
    market: t.hex().notNull(),
    maturity: t.bigint().notNull(),
    assets: t.bigint().notNull(),
    usdPrice: t.bigint().notNull(),
    fee: t.bigint().notNull(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const repays = onchainTable(
  "repays",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    caller: t.hex().notNull(),
    market: t.hex().notNull(),
    maturity: t.bigint().notNull(),
    assets: t.bigint().notNull(),
    usdPrice: t.bigint().notNull(),
    positionAssets: t.bigint().notNull(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const proposals = onchainTable(
  "proposals",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    proposalManager: t.hex().notNull(),
    nonce: t.bigint().notNull(),
    market: t.hex().notNull(),
    proposalType: t.integer().notNull(),
    amount: t.bigint().notNull(),
    data: t.hex().notNull(),
    unlock: t.bigint().notNull(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const swaps = onchainTable(
  "swaps",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    transactionId: t.hex().notNull(),
    fromAsset: t.hex().notNull(),
    toAsset: t.hex().notNull(),
    fromAmount: t.bigint().notNull(),
    toAmount: t.bigint().notNull(),
    fromUsdPrice: t.bigint(),
    toUsdPrice: t.bigint(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

export const bridgeCompletions = onchainTable(
  "bridge_completions",
  (t) => ({
    ...log(t),
    transactionId: t.hex().notNull(),
    asset: t.hex().notNull(),
    receiver: t.hex().notNull(),
    amount: t.bigint().notNull(),
  }),
  (table) => ({ transaction: index().on(table.transactionId) }),
);

export const bridges = onchainTable(
  "bridges",
  (t) => ({
    ...log(t),
    account: t.hex(),
    transactionId: t.hex().notNull(),
    bridge: t.text().notNull(),
    asset: t.hex().notNull(),
    amount: t.bigint().notNull(),
    receiver: t.hex().notNull(),
    destinationChainId: t.bigint().notNull(),
    usdPrice: t.bigint(),
  }),
  (table) => ({
    account: index().on(table.chainId, table.account),
    receiver: index().on(table.destinationChainId, table.receiver),
  }),
);

export const liquidations = onchainTable(
  "liquidations",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    liquidator: t.hex().notNull(),
    market: t.hex().notNull(),
    assets: t.bigint().notNull(),
    lendersAssets: t.bigint().notNull(),
    seizeMarket: t.hex().notNull(),
    seizedAssets: t.bigint().notNull(),
    usdPrice: t.bigint().notNull(),
    seizeUsdPrice: t.bigint().notNull(),
  }),
  (table) => ({ account: index().on(table.chainId, table.account) }),
);

function log(t: PgColumnsBuilders) {
  return {
    id: t.text().primaryKey(),
    chainId: t.integer().notNull(),
    hash: t.hex().notNull(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
    transactionIndex: t.integer().notNull(),
    logIndex: t.integer().notNull(),
  };
}
