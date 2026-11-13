import { integer, numeric, pgSchema, text } from "drizzle-orm/pg-core";

import type { Hex } from "viem";

const indexer = pgSchema("indexer");

export const accounts = indexer
  .view("accounts", {
    chainId: integer("chain_id").notNull(),
    address: text("address").$type<Hex>().notNull(),
    factory: text("factory").$type<Hex>().notNull(),
    owner: text("owner").$type<Hex>(),
    plugin: text("plugin").$type<Hex>(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
  })
  .existing();

export const plugins = indexer
  .view("plugins", {
    chainId: integer("chain_id").notNull(),
    account: text("account").$type<Hex>().notNull(),
    address: text("address").$type<Hex>().notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
    uninstalled: numeric("uninstalled", { mode: "bigint" }),
  })
  .existing();

export const exaPlugins = indexer
  .view("exa_plugins", {
    chainId: integer("chain_id").notNull(),
    address: text("address").$type<Hex>().notNull(),
  })
  .existing();

export const proposalManagers = indexer
  .view("proposal_managers", {
    chainId: integer("chain_id").notNull(),
    plugin: text("plugin").$type<Hex>().notNull(),
    address: text("address").$type<Hex>().notNull(),
  })
  .existing();

export const collectors = indexer
  .view("collectors", {
    chainId: integer("chain_id").notNull(),
    plugin: text("plugin").$type<Hex>().notNull(),
    address: text("address").$type<Hex>().notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    logIndex: integer("log_index").notNull(),
  })
  .existing();

export const delays = indexer
  .view("delays", {
    chainId: integer("chain_id").notNull(),
    proposalManager: text("proposal_manager").$type<Hex>().notNull(),
    delay: numeric("delay", { mode: "bigint" }).notNull(),
  })
  .existing();

export const markets = indexer
  .view("markets", {
    chainId: integer("chain_id").notNull(),
    address: text("address").$type<Hex>().notNull(),
    asset: text("asset").$type<Hex>().notNull(),
    symbol: text("symbol").notNull(),
    decimals: integer("decimals").notNull(),
    priceFeed: text("price_feed").$type<Hex>(),
  })
  .existing();

export const tokens = indexer
  .view("tokens", {
    chainId: integer("chain_id").notNull(),
    address: text("address").$type<Hex>().notNull(),
    symbol: text("symbol").notNull(),
    decimals: integer("decimals").notNull(),
  })
  .existing();

export const deposits = indexer
  .view("deposits", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    caller: text("caller").$type<Hex>().notNull(),
    market: text("market").$type<Hex>().notNull(),
    assets: numeric("assets", { mode: "bigint" }).notNull(),
    usdPrice: numeric("usd_price", { mode: "bigint" }).notNull(),
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
    usdPrice: numeric("usd_price", { mode: "bigint" }).notNull(),
    input: text("input").$type<Hex>(),
    proposalManager: text("proposal_manager").$type<Hex>(),
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
    usdPrice: numeric("usd_price", { mode: "bigint" }).notNull(),
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
    usdPrice: numeric("usd_price", { mode: "bigint" }).notNull(),
    positionAssets: numeric("position_assets", { mode: "bigint" }).notNull(),
  })
  .existing();

export const proposals = indexer
  .view("proposals", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    proposalManager: text("proposal_manager").$type<Hex>().notNull(),
    nonce: numeric("nonce", { mode: "bigint" }).notNull(),
    market: text("market").$type<Hex>().notNull(),
    proposalType: integer("proposal_type").notNull(),
    amount: numeric("amount", { mode: "bigint" }).notNull(),
    data: text("data").$type<Hex>().notNull(),
    unlock: numeric("unlock", { mode: "bigint" }).notNull(),
  })
  .existing();

export const swaps = indexer
  .view("swaps", {
    ...log(),
    account: text("account").$type<Hex>().notNull(),
    transactionId: text("transaction_id").$type<Hex>().notNull(),
    fromAsset: text("from_asset").$type<Hex>().notNull(),
    toAsset: text("to_asset").$type<Hex>().notNull(),
    fromAmount: numeric("from_amount", { mode: "bigint" }).notNull(),
    toAmount: numeric("to_amount", { mode: "bigint" }).notNull(),
    fromUsdPrice: numeric("from_usd_price", { mode: "bigint" }),
    toUsdPrice: numeric("to_usd_price", { mode: "bigint" }),
  })
  .existing();

export const bridges = indexer
  .view("bridges", {
    ...log(),
    account: text("account").$type<Hex>(),
    transactionId: text("transaction_id").$type<Hex>().notNull(),
    bridge: text("bridge").notNull(),
    asset: text("asset").$type<Hex>().notNull(),
    amount: numeric("amount", { mode: "bigint" }).notNull(),
    receiver: text("receiver").$type<Hex>().notNull(),
    destinationChainId: numeric("destination_chain_id", { mode: "bigint" }).notNull(),
    usdPrice: numeric("usd_price", { mode: "bigint" }),
  })
  .existing();

function log() {
  return {
    id: text("id").notNull(),
    chainId: integer("chain_id").notNull(),
    hash: text("hash").$type<Hex>().notNull(),
    block: numeric("block", { mode: "bigint" }).notNull(),
    timestamp: numeric("timestamp", { mode: "bigint" }).notNull(),
    transactionIndex: integer("transaction_index").notNull(),
    logIndex: integer("log_index").notNull(),
  };
}
