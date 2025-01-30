import { relations } from "drizzle-orm";
import { customType, integer, jsonb, pgEnum, pgTable, text, uniqueIndex } from "drizzle-orm/pg-core";

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
  (table) => [{ build: () => uniqueIndex("account_index").on(table.account) }],
);

export const cards = pgTable("cards", {
  id: text("id").primaryKey(),
  credentialId: text("credential_id")
    .references(() => credentials.id)
    .notNull(),
  status: cardStatus("status").notNull().default("ACTIVE"),
  lastFour: text("last_four").notNull(),
  mode: integer("mode").notNull().default(1),
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
