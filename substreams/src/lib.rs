#![expect(clippy::not_unsafe_ptr_arg_deref)]

use serde::Deserialize;
use std::collections::HashSet;
use substreams::{
  Hex,
  errors::Error,
  pb::substreams::Clock,
  store::{StoreGet, StoreGetInt64, StoreNew, StoreSet, StoreSetInt64},
};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{Event, pb::eth::v2::Block};

use crate::{
  contracts::{account::events::PluginInstalled, factory::events::ExaAccountInitialized},
  proto::exa::{Accounts, Plugins, plugins::Plugin},
};

mod contracts;
mod proto;

#[derive(Debug, Deserialize)]
struct Factories {
  factories: Vec<String>,
}

#[substreams::handlers::map]
pub fn map_exa_accounts(params: String, block: Block) -> Result<Accounts, Error> {
  Ok(Accounts {
    accounts: block
      .events::<ExaAccountInitialized>(
        &serde_qs::from_str::<Factories>(&params)?
          .factories
          .iter()
          .map(Hex::decode)
          .collect::<Result<Vec<_>, _>>()?
          .iter()
          .map(Vec::as_slice)
          .collect::<Vec<_>>(),
      )
      .map(|(event, _)| event.account)
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_exa_accounts(new: Accounts, store: StoreSetInt64) {
  for account in new.accounts {
    store.set(0, Hex(&account).to_string(), &1);
  }
}

#[substreams::handlers::map]
pub fn map_exa_plugins(block: Block, new: Accounts, accounts: StoreGetInt64) -> Result<Plugins, Error> {
  let mut seen = HashSet::new();
  Ok(Plugins {
    plugins: block
      .logs()
      .filter_map(|log| {
        let event = PluginInstalled::match_and_decode(log)?;
        let address = log.address();
        (if new.accounts.iter().any(|new_account| address == new_account.as_slice()) {
          !seen.insert(address.to_vec())
        } else {
          accounts.get_last(Hex(&address).to_string())? == 1
        })
        .then(|| Plugin { address: event.plugin, account: address.to_vec(), ordinal: log.ordinal() })
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn db_out(clock: Clock, plugins: Plugins) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  for plugin in plugins.plugins {
    tables.upsert_row(
      "exa_plugins",
      [("address", Hex(&plugin.address).to_string()), ("account", Hex(&plugin.account).to_string())],
    );
  }
  if tables.all_row_count() > 0 {
    tables
      .create_row("blocks", clock.number.to_string())
      .set("timestamp", clock.timestamp.unwrap_or_default().seconds.to_string());
  }
  Ok(tables.to_database_changes())
}
