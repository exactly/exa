import { relations } from "drizzle-orm";
import { customType, integer, jsonb, numeric, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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
  (table) => [uniqueIndex("account_index").on(table.account)],
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

export const swaps = pgTable(
  "swaps",
  {
    id: text("id").primaryKey(),
    receiver: text("receiver").notNull(),
    fromAssetId: text("from_asset_id").notNull(),
    toAssetId: text("to_asset_id").notNull(),
    fromAmount: numeric("from_amount").notNull(),
    toAmount: numeric("to_amount").notNull(),
  },
  (table) => [uniqueIndex("receiver_index").on(table.receiver)],
);

// export const cursors = pgTable("cursors", {
//   id: text("id").primaryKey(),
//   cursor: text("cursor"),
//   blockNum: integer("block_num"),
//   blockId: text("block_id"),
// });

// export const substreamsHistoryId = pgSequence("substreams_history_id_seq");

// export const substreamsHistory = pgTable("substreams_history", {
//   id: integer("id")
//     .primaryKey()
//     .default(sql`nextval('substreams_history_id_seq'::regclass)`), // cspell:ignore nextval regclass
//   op: text("op").notNull(),
//   tableName: text("table_name").notNull(),
//   pk: text("pk").notNull(),
//   prevValue: text("prev_value"),
//   blockNum: integer("block_num"),
// });
