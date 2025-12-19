#![expect(clippy::not_unsafe_ptr_arg_deref)]

use contracts::factory::events as factory_events;
use proto::exa::{events::ExaAccountInitialized, Events};
use serde::Deserialize;
use substreams::{errors::Error, pb::substreams::Clock, Hex};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[derive(Debug, Deserialize)]
struct Params {
  factories: Vec<String>,
}

#[substreams::handlers::map]
pub fn map_blocks(params: String, block: Block) -> Result<Events, Error> {
  let query = serde_qs::from_str::<Params>(params.as_str())?;
  let factories = query.factories.iter().map(Hex::decode).collect::<Result<Vec<_>, _>>()?;
  Ok(Events {
    exa_account_initialized: block
      .logs()
      .filter_map(|log| {
        match (
          factories.iter().any(|factory| log.address() == factory),
          factory_events::ExaAccountInitialized::match_and_decode(log),
        ) {
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
