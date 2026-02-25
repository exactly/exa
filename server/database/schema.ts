import { relations } from "drizzle-orm";
import {
  bigint,
  char,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgSchema,
  pgTable,
  primaryKey,
  serial,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { PLATINUM_PRODUCT_ID } from "@exactly/common/panda";

const bytea = customType<{ data: Uint8Array<ArrayBuffer>; driverData: string }>({ dataType: () => "bytea" });

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
    bridgeId: text("bridge_id"),
    source: text("source"),
  },
  ({ account }) => [uniqueIndex("account_index").on(account)],
);

export const cards = pgTable(
  "cards",
  {
    id: text("id").primaryKey(),
    credentialId: text("credential_id")
      .references(() => credentials.id)
      .notNull(),
    status: cardStatus("status").notNull().default("ACTIVE"),
    lastFour: text("last_four").notNull(),
    mode: integer("mode").notNull().default(0),
    productId: text("product_id").notNull().default(PLATINUM_PRODUCT_ID),
  },
  ({ credentialId }) => [index("cards_credential_id_index").on(credentialId)],
);

export const transactions = pgTable(
  "transactions",
  {
    id: text("id").primaryKey(),
    cardId: text("card_id")
      .references(() => cards.id)
      .notNull(),
    hashes: text("hashes").array().notNull(),
    payload: jsonb("payload").notNull(),
  },
  ({ cardId }) => [index("transactions_card_id_index").on(cardId)],
);

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
  number: bigint("number", { mode: "bigint" }).primaryKey(),
  timestamp: bigint("timestamp", { mode: "bigint" }).notNull(),
});

export const exaPlugins = substreams.table(
  "exa_plugins",
  {
    address: text("address").notNull(),
    account: text("account").notNull(),
  },
  ({ address, account }) => [primaryKey({ columns: [address, account] })],
);
