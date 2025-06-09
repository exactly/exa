use contracts::{is_market, market::events};
use proto::exa::{
  events::{MarketUpdate, Transfer},
  Events,
};
use substreams::{
  errors::Error,
  hex,
  key::segment_at,
  pb::substreams::Clock,
  scalar::BigInt,
  store::{DeltaBigInt, DeltaExt, DeltaProto, Deltas, StoreAdd, StoreAddBigInt, StoreNew, StoreSet, StoreSetProto},
  Hex,
};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[substreams::handlers::map]
pub fn map_blocks(block: Block) -> Result<Events, Error> {
  Ok(Events {
    market_updates: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::MarketUpdate::match_and_decode(log)) {
        (true, Some(event)) => Some(MarketUpdate {
          market: log.address().to_vec(),
          floating_deposit_shares: event.floating_deposit_shares.to_string(),
          floating_assets: event.floating_assets.to_string(),
          floating_borrow_shares: event.floating_borrow_shares.to_string(),
          floating_debt: event.floating_debt.to_string(),
          earnings_accumulator: event.earnings_accumulator.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    transfers: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::Transfer::match_and_decode(log)) {
        (true, Some(event)) => Some(Transfer {
          token: log.address().to_vec(),
          from: event.from.to_vec(),
          to: event.to.to_vec(),
          amount: event.amount.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_market_updates(events: Events, output: StoreSetProto<MarketUpdate>) {
  for market_update in events.market_updates {
    output.set(
      market_update.log_ordinal,
      format!("market:{market}", market = Hex(&market_update.market)),
      &market_update,
    );
  }
}

#[substreams::handlers::store]
pub fn store_account_shares(events: Events, output: StoreAddBigInt) {
  for transfer in events.transfers {
    if transfer.to != hex!("0000000000000000000000000000000000000000") {
      output.add(
        transfer.log_ordinal,
        format!("shares:{market}:{account}", market = Hex(&transfer.token), account = Hex(&transfer.to)),
        &BigInt::try_from(transfer.amount.clone()).unwrap(),
      );
    }
    if transfer.from != hex!("0000000000000000000000000000000000000000") {
      output.add(
        transfer.log_ordinal,
        format!("shares:{market}:{account}", market = Hex(&transfer.token), account = Hex(&transfer.from)),
        &BigInt::try_from(transfer.amount.clone()).unwrap().neg(),
      );
    }
  }
}

#[substreams::handlers::map]
pub fn db_out(
  clock: Clock,
  market_updates_deltas: Deltas<DeltaProto<MarketUpdate>>,
  account_shares_deltas: Deltas<DeltaBigInt>,
) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  let timestamp = clock.timestamp.unwrap_or_default().seconds.to_string();
  for delta in market_updates_deltas.iter().key_first_segment_eq("market") {
    tables
      .create_row("market_updates", [("market", segment_at(&delta.key, 1)), ("timestamp", &timestamp)])
      .set("floating_deposit_shares", &delta.new_value.floating_deposit_shares)
      .set("floating_assets", &delta.new_value.floating_assets)
      .set("floating_borrow_shares", &delta.new_value.floating_borrow_shares)
      .set("floating_debt", &delta.new_value.floating_debt)
      .set("earnings_accumulator", &delta.new_value.earnings_accumulator);
  }
  for delta in account_shares_deltas.iter().key_first_segment_eq("shares") {
    tables
      .create_row(
        "shares",
        [("market", segment_at(&delta.key, 1)), ("account", segment_at(&delta.key, 2)), ("timestamp", &timestamp)],
      )
      .set("amount", delta.new_value.to_string());
  }
  Ok(tables.to_database_changes())
}
