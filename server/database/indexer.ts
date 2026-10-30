import { integer, numeric, pgSchema, text } from "drizzle-orm/pg-core";

import type { Hex } from "viem";

const indexer = pgSchema("indexer");

export const accounts = indexer
  .view("accounts", {
    address: text("address").$type<Hex>().notNull(),
    factory: text("factory").$type<Hex>().notNull(),
    owner: text("owner").$type<Hex>(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
  })
  .existing();

export const plugins = indexer
  .view("plugins", {
    account: text("account").$type<Hex>().notNull(),
    address: text("address").$type<Hex>().notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
  })
  .existing();

export const deposits = indexer
  .view("deposits", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    caller: text("caller").$type<Hex>().notNull(),
    market: text("market").$type<Hex>().notNull(),
    assets: numeric("assets", { mode: "bigint" }).notNull(),
  })
  .existing();

export const withdraws = indexer
  .view("withdraws", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    caller: text("caller").$type<Hex>().notNull(),
    receiver: text("receiver").$type<Hex>().notNull(),
    market: text("market").$type<Hex>().notNull(),
    assets: numeric("assets", { mode: "bigint" }).notNull(),
    input: text("input").$type<Hex>(),
    manager: text("manager").$type<Hex>(),
  })
  .existing();

export const borrows = indexer
  .view("borrows", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    caller: text("caller").$type<Hex>().notNull(),
    receiver: text("receiver").$type<Hex>().notNull(),
    market: text("market").$type<Hex>().notNull(),
    maturity: numeric("maturity", { mode: "bigint" }).notNull(),
    assets: numeric("assets", { mode: "bigint" }).notNull(),
    fee: numeric("fee", { mode: "bigint" }).notNull(),
  })
  .existing();

export const repays = indexer
  .view("repays", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    caller: text("caller").$type<Hex>().notNull(),
    market: text("market").$type<Hex>().notNull(),
    maturity: numeric("maturity", { mode: "bigint" }).notNull(),
    assets: numeric("assets", { mode: "bigint" }).notNull(),
    positionAssets: numeric("position_assets", { mode: "bigint" }).notNull(),
  })
  .existing();

export const proposals = indexer
  .view("proposals", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    manager: text("manager").$type<Hex>().notNull(),
    nonce: numeric("nonce", { mode: "bigint" }).notNull(),
    market: text("market").$type<Hex>().notNull(),
    proposalType: integer("proposal_type").notNull(),
    amount: numeric("amount", { mode: "bigint" }).notNull(),
    data: text("data").$type<Hex>().notNull(),
    unlock: numeric("unlock", { mode: "bigint" }).notNull(),
  })
  .existing();

function log() {
  return {
    id: text("id").notNull(),
    hash: text("hash").$type<Hex>().notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
  };
}
