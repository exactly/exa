use contracts::{is_market, market::events};
use proto::exa::{events::Transfer, Events};
use substreams::{
  errors::Error,
  hex,
  key::segment_at,
  pb::substreams::Clock,
  scalar::BigInt,
  store::{DeltaBigInt, DeltaExt, Deltas, StoreAdd, StoreAddBigInt, StoreNew},
  Hex,
};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[substreams::handlers::map]
pub fn map_blocks(block: Block) -> Result<Events, Error> {
  Ok(Events {
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
pub fn db_out(clock: Clock, account_shares_deltas: Deltas<DeltaBigInt>) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  let timestamp = clock.timestamp.unwrap_or_default().seconds.to_string();
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
