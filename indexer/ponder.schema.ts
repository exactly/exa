import { index, onchainTable, primaryKey, type PgColumnsBuilders } from "ponder";

export const accounts = onchainTable(
  "accounts",
  (t) => ({
    chainId: t.integer().notNull(),
    address: t.hex().notNull(),
    factory: t.hex().notNull(),
    owner: t.hex(),
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
  }),
  (table) => ({ pk: primaryKey({ columns: [table.chainId, table.account, table.address] }) }),
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

export const deposits = onchainTable(
  "deposits",
  (t) => ({
    ...log(t),
    account: t.hex().notNull(),
    caller: t.hex().notNull(),
    market: t.hex().notNull(),
    assets: t.bigint().notNull(),
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
