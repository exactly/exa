import { onchainTable, primaryKey } from "ponder";

export const accounts = onchainTable("accounts", (t) => ({
  address: t.hex().primaryKey(),
  factory: t.hex().notNull(),
  owner: t.hex(),
  block: t.bigint().notNull(),
  timestamp: t.bigint().notNull(),
}));

export const plugins = onchainTable(
  "plugins",
  (t) => ({
    account: t.hex().notNull(),
    address: t.hex().notNull(),
    block: t.bigint().notNull(),
    timestamp: t.bigint().notNull(),
  }),
  (table) => ({ pk: primaryKey({ columns: [table.account, table.address] }) }),
);
