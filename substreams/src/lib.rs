use contracts::{factory::events as factory_events, is_factory};
use proto::exa::{events::ExaAccountInitialized, Events};
use substreams::{errors::Error, pb::substreams::Clock, Hex};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[substreams::handlers::map]
pub fn map_blocks(block: Block) -> Result<Events, Error> {
  Ok(Events {
    exa_account_initialized: block
      .logs()
      .filter_map(|log| {
        match (is_factory(log.address()), factory_events::ExaAccountInitialized::match_and_decode(log)) {
          (true, Some(event)) => {
            Some(ExaAccountInitialized { address: event.account.to_vec(), log_ordinal: log.ordinal() })
          }
          _ => None,
        }
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn db_out(clock: Clock, events: Events) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  tables
    .create_row("blocks", clock.number.to_string())
    .set("timestamp", clock.timestamp.unwrap_or_default().seconds.to_string());
  for exa_account_initialized in events.exa_account_initialized {
    tables
      .create_row("exa_account_initialized", [("address", Hex(&exa_account_initialized.address).to_string())])
      .set("address", Hex(&exa_account_initialized.address).to_string())
      .set("block", clock.number.to_string())
      .set("ordinal", exa_account_initialized.log_ordinal.to_string());
  }
  Ok(tables.to_database_changes())
}
