import { relations } from "drizzle-orm";
import {
  bigint,
  boolean,
  char,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const bytea = customType<{ data: Uint8Array; driverData: string }>({ dataType: () => "bytea" });

export const cardStatus = pgEnum("card_status", ["ACTIVE", "FROZEN", "DELETED"]);

export const credentials = pgTable(
  "credentials",
  {
    id: text("id").primaryKey(),
    publicKey: bytea("public_key").notNull(),
    factory: text("factory").notNull(),
    account: text("account").notNull(),
    transports: text("transports").array(),
    counter: integer("counter").notNull().default(0),
    kycId: text("kyc_id"),
    pandaId: text("panda_id"),
  },
  ({ account }) => [uniqueIndex("account_index").on(account)],
);

export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id")
    .references(() => credentials.id)
    .notNull(),
  status: cardStatus("status").notNull().default("ACTIVE"),
  lastFour: text("last_four").notNull(),
  mode: integer("mode").notNull().default(0),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  cardId: text("card_id")
    .references(() => cards.id)
    .notNull(),
  hashes: text("hashes").array().notNull(),
  payload: jsonb("payload").notNull(),
});

export const credentialsRelations = relations(credentials, ({ many }) => ({ cards: many(cards) }));

export const cardsRelations = relations(cards, ({ many, one }) => ({
  credential: one(credentials, { fields: [cards.credentialId], references: [credentials.id] }),
  transactions: many(transactions),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  card: one(cards, { fields: [transactions.cardId], references: [cards.id] }),
}));

export const substreams = pgSchema("substreams");

export const cursors = substreams.table("cursors", {
  id: text("id").primaryKey(),
  cursor: text("cursor"),
  blockNum: bigint("block_num", { mode: "bigint" }),
  blockId: text("block_id"),
});

export const substreamsHistory = substreams.table("substreams_history", {
  id: serial("id").primaryKey(),
  op: char("op", { length: 1 }),
  tableName: text("table_name"),
  pk: text("pk"),
  prevValue: text("prev_value"),
  blockNum: bigint("block_num", { mode: "bigint" }),
});

export const blocks = substreams.table("blocks", {
  number: numeric("number").primaryKey(),
  timestamp: numeric("timestamp").notNull(),
});

// markets
export const accumulatorAccruals = substreams.table(
  "accumulator_accruals",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("accumulator_accruals_block").on(market, block),
    index("accumulator_accruals_market").on(market),
  ],
);

export const earningsAccumulatorSmoothFactorSets = substreams.table(
  "earnings_accumulator_smooth_factors",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    earningsAccumulatorSmoothFactor: numeric("earnings_accumulator_smooth_factor", { mode: "string" }).notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("earnings_accumulator_smooth_factor_sets_block").on(market, block),
    index("earnings_accumulator_smooth_factor_sets_market").on(market),
  ],
);

export const fixedEarningsUpdates = substreams.table(
  "fixed_earnings_updates",
  {
    market: text("market").notNull(),
    maturity: numeric("maturity").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    unassignedEarnings: numeric("unassigned_earnings", { mode: "string" }).notNull(),
  },
  ({ market, maturity, block, ordinal }) => [
    primaryKey({ columns: [market, maturity, block, ordinal] }),
    index("fixed_earnings_updates_block").on(market, maturity, block),
    index("fixed_earnings_updates_maturity").on(market, maturity),
    index("fixed_earnings_updates_market").on(market),
  ],
);

export const floatingDebtUpdates = substreams.table(
  "floating_debt_updates",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    utilization: numeric("utilization", { mode: "string" }).notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("floating_debt_updates_block").on(market, block),
    index("floating_debt_updates_market").on(market),
  ],
);

export const interestRateModels = substreams.table(
  "interest_rate_models",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    address: text("address").notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("interest_rate_models_block").on(market, block),
    index("interest_rate_models_market").on(market),
  ],
);

export const marketUpdates = substreams.table(
  "market_updates",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    floatingDepositShares: numeric("floating_deposit_shares", { mode: "string" }).notNull(),
    floatingAssets: numeric("floating_assets", { mode: "string" }).notNull(),
    floatingBorrowShares: numeric("floating_borrow_shares", { mode: "string" }).notNull(),
    floatingDebt: numeric("floating_debt", { mode: "string" }).notNull(),
    earningsAccumulator: numeric("earnings_accumulator", { mode: "string" }).notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("market_updates_block").on(market, block),
    index("market_updates_market").on(market),
  ],
);

export const maxFuturePools = substreams.table(
  "max_future_pools",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    maxFuturePools: numeric("max_future_pools").notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("max_future_pools_block").on(market, block),
    index("max_future_pools_market").on(market),
  ],
);

export const treasuries = substreams.table(
  "treasuries",
  {
    market: text("market").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    treasury: text("treasury").notNull(),
    treasuryFeeRate: numeric("treasury_fee_rate", { mode: "string" }).notNull(),
  },
  ({ market, block, ordinal }) => [
    primaryKey({ columns: [market, block, ordinal] }),
    index("treasuries_block").on(market, block),
    index("treasuries_market").on(market),
  ],
);

// accounts
export const borrowShares = substreams.table(
  "borrow_shares",
  {
    market: text("market").notNull(),
    borrower: text("borrower").notNull(),
    shares: numeric("shares", { mode: "string" }).notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ market, borrower, block, ordinal }) => [
    primaryKey({ columns: [market, borrower, block, ordinal] }),
    index("borrow_shares_block").on(market, borrower, block),
    index("borrow_shares_borrower").on(market, borrower),
    index("borrow_shares_market").on(market),
  ],
);

export const marketEnters = substreams.table(
  "market_enters",
  {
    market: text("market").notNull(),
    account: text("account").notNull(),
    entered: boolean("entered").notNull().default(false),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ market, account, entered, block, ordinal }) => [
    primaryKey({ columns: [market, account, entered, block, ordinal] }),
    index("market_enters_account").on(market, account),
    index("market_enters_market").on(market),
  ],
);

export const depositShares = substreams.table(
  "deposit_shares",
  {
    market: text("market").notNull(),
    account: text("account").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
    shares: numeric("shares", { mode: "string" }).notNull(),
  },
  ({ market, account, block, ordinal }) => [
    primaryKey({ columns: [market, account, block, ordinal] }),
    index("deposit_shares_block").on(market, account, block),
    index("deposit_shares_account").on(market, account),
    index("deposit_shares_market").on(market),
  ],
);

export const fixedBorrows = substreams.table(
  "fixed_borrows",
  {
    market: text("market").notNull(),
    maturity: numeric("maturity").notNull(),
    borrower: text("borrower").notNull(),
    positionAssets: text("position_assets").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ market, maturity, borrower, block, ordinal }) => [
    primaryKey({ columns: [market, maturity, borrower, block, ordinal] }),
    index("fixed_borrows_block").on(market, maturity, borrower, block),
    index("fixed_borrows_maturity").on(market, maturity),
    index("fixed_borrows_borrower").on(market, borrower),
    index("fixed_borrows_market").on(market),
  ],
);

// plugin
export const exaAccountInitialized = substreams.table(
  "exa_account_initialized",
  {
    address: text("address").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ address }) => [primaryKey({ columns: [address] })],
);

export const collectorSets = substreams.table(
  "collector_sets",
  {
    collector: text("collector").notNull(),
    account: text("account").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ collector, account, block, ordinal }) => [
    primaryKey({ columns: [collector, account, block, ordinal] }),
    index("collector_sets_account").on(account),
    index("collector_sets_collector").on(collector),
  ],
);

export const proposalManagerSets = substreams.table(
  "proposal_manager_sets",
  {
    proposalManager: text("proposal_manager").notNull(),
    account: text("account").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ proposalManager, account, block, ordinal }) => [
    primaryKey({ columns: [proposalManager, account, block, ordinal] }),
    index("proposal_manager_sets_account").on(account),
    index("proposal_manager_sets_proposal_manager").on(proposalManager),
  ],
);

// proposal manager
export const delaySets = substreams.table(
  "delay_sets",
  {
    delay: numeric("delay").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ delay, block, ordinal }) => [primaryKey({ columns: [delay, block, ordinal] })],
);

export const proposalNonceSets = substreams.table(
  "proposal_nonce_sets",
  {
    account: text("account").notNull(),
    nonce: numeric("nonce").notNull(),
    executed: boolean("executed").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ account, nonce, executed }) => [
    primaryKey({ columns: [account, nonce] }),
    index("proposal_nonce_sets_account").on(account),
    index("proposal_nonce_sets_nonce").on(nonce),
    index("proposal_nonce_sets_executed").on(executed),
  ],
);

export const proposed = substreams.table(
  "proposed",
  {
    account: text("account").notNull(),
    nonce: numeric("nonce").notNull(),
    market: text("market").notNull(),
    proposalType: numeric("proposal_type").notNull(),
    amount: numeric("amount", { mode: "string" }).notNull(),
    data: bytea("data").notNull(),
    unlock: numeric("unlock").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ account, nonce, market, proposalType }) => [
    primaryKey({ columns: [account, nonce] }),
    index("proposed_account").on(account),
    index("proposed_market").on(market),
    index("proposed_proposal_type").on(proposalType),
  ],
);

export const targetAllowed = substreams.table(
  "target_allowed",
  {
    target: text("target").notNull(),
    sender: text("sender").notNull(),
    allowed: boolean("allowed").notNull(),
    block: numeric("block")
      .references(() => blocks.number)
      .notNull(),
    ordinal: numeric("ordinal").notNull(),
  },
  ({ target, sender, allowed, block, ordinal }) => [
    primaryKey({ columns: [target, sender, block, ordinal] }),
    index("target_allowed_target").on(target),
    index("target_allowed_sender").on(sender),
    index("target_allowed_allowed").on(allowed),
  ],
);
