#![expect(clippy::not_unsafe_ptr_arg_deref)]

use contracts::{account::events as account_events, factory::events::ExaAccountInitialized};
use proto::exa::{account_events::PluginInstalled, AccountEvents, Accounts};
use serde::Deserialize;
use substreams::{
  errors::Error,
  pb::substreams::Clock,
  store::{Appender, StoreAppend, StoreGet, StoreGetRaw},
  Hex,
};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[derive(Debug, Deserialize)]
struct Params {
  factories: Vec<String>,
}

#[substreams::handlers::map]
pub fn map_exa_accounts(params: String, block: Block) -> Result<Accounts, Error> {
  Ok(Accounts {
    accounts: block
      .events::<ExaAccountInitialized>(
        &serde_qs::from_str::<Params>(&params)?
          .factories
          .iter()
          .map(Hex::decode)
          .collect::<Result<Vec<_>, _>>()?
          .iter()
          .map(Vec::as_slice)
          .collect::<Vec<_>>(),
      )
      .map(|(event, _)| Hex(&event.account).to_string())
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_exa_accounts(accounts: Accounts, output: StoreAppend<String>) {
  output.append_all(1, ".", accounts.accounts);
}

#[substreams::handlers::map]
pub fn map_account_events(block: Block, account_store: StoreGetRaw) -> Result<AccountEvents, Error> {
  let accounts = account_store
    .get_last(".")
    .map(|bytes| -> Result<Vec<_>, Error> {
      Ok(String::from_utf8(bytes)?.split_terminator(";").map(Hex::decode).collect::<Result<Vec<_>, _>>()?)
    })
    .transpose()?
    .unwrap_or_default();
  Ok(AccountEvents {
    plugins: block
      .logs()
      .filter_map(|log| {
        match (
          accounts.iter().any(|account| log.address() == account),
          account_events::PluginInstalled::match_and_decode(log),
        ) {
          (true, Some(event)) => Some(PluginInstalled {
            plugin: event.plugin.to_vec(),
            account: log.address().to_vec(),
            manifest_hash: event.manifest_hash.to_vec(),
            log_ordinal: log.ordinal(),
          }),
          _ => None,
        }
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn db_out(clock: Clock, events: AccountEvents) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  for event in events.plugins {
    tables
      .create_row(
        "plugin_installed",
        [
          ("plugin", Hex(&event.plugin).to_string()),
          ("account", Hex(&event.account).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", event.log_ordinal.to_string()),
        ],
      )
      .set("plugin", Hex(&event.plugin).to_string())
      .set("account", Hex(&event.account).to_string())
      .set("block", clock.number.to_string())
      .set("ordinal", event.log_ordinal.to_string());
  }
  if tables.all_row_count() > 0 {
    tables
      .create_row("blocks", clock.number.to_string())
      .set("timestamp", clock.timestamp.unwrap_or_default().seconds.to_string());
  }
  Ok(tables.to_database_changes())
}
