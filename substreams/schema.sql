CREATE TABLE accounts (
  id BIGSERIAL PRIMARY KEY,
  address BYTEA NOT NULL
);

CREATE TABLE deposits (
  id TEXT PRIMARY KEY,
  receiver BYTEA NOT NULL,
  market BYTEA NOT NULL,
  amount TEXT NOT NULL
);

CREATE TABLE swaps (
  id TEXT PRIMARY KEY,
  receiver BYTEA NOT NULL,
  assetFrom BYTEA NOT NULL,
  assetTo BYTEA NOT NULL,
  amountFrom TEXT NOT NULL,
  amountTo TEXT NOT NULL
);

CREATE TABLE transfers (
  id BIGSERIAL PRIMARY KEY,
  asset BYTEA NOT NULL,
  receiver BYTEA NOT NULL
);

CREATE TABLE transfers_all (
  id BIGSERIAL PRIMARY KEY,
  asset BYTEA NOT NULL,
  receiver BYTEA NOT NULL
);