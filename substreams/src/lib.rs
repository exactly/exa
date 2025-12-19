#![expect(clippy::not_unsafe_ptr_arg_deref)]

use contracts::{account::events as account_events, factory::events as factory_events};
use proto::exa::{
  events::{ExaAccountInitialized, PluginInstalled},
  Events,
};
use serde::Deserialize;
use substreams::{
  errors::Error,
  pb::substreams::Clock,
  store::{Appender, StoreAppend, StoreGet, StoreGetRaw, StoreNew, StoreSet, StoreSetProto},
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
    plugin_installed: block
      .logs()
      .filter_map(|log| match (true, account_events::PluginInstalled::match_and_decode(log)) {
        (true, Some(event)) => Some(PluginInstalled {
          plugin: event.plugin.to_vec(),
          account: log.address().to_vec(),
          manifest_hash: event.manifest_hash.to_vec(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_exa_accounts(events: Events, output: StoreAppend<Vec<u8>>) {
  for exa_account_initialized in events.exa_account_initialized {
    output.append_all(1, format!("{}", exa_account_initialized.address), exa_account_initialized.log_ordinal);
  }
}

#[substreams::handlers::store]
pub fn store_plugin_installed(events: Events, accounts: StoreGetRaw, output: StoreSetProto<PluginInstalled>) {
  for plugin_installed in events.plugin_installed {
    if let Some(_account) = accounts.get_last(&plugin_installed.account) {
      // TODO check comparison
      output.set(plugin_installed.log_ordinal, plugin_installed, &1);
    }
  }
}

#[substreams::handlers::map]
pub fn db_out(
  clock: Clock,
  events: Events,
  // plugin_installed: Deltas<DeltaProto<PluginInstalled>>,
) -> Result<DatabaseChanges, Error> {
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

  // for delta in plugin_installed.iter() {
  //   tables
  //     .create_row(
  //       "plugin_installed",
  //       [
  //         ("plugin", Hex(&delta.key).to_string()),
  //         ("account", Hex(&delta.new_value.account).to_string()),
  //         ("block", clock.number.to_string()),
  //         ("ordinal", delta.ordinal.to_string()),
  //       ],
  //     )
  //     .set("plugin", Hex(&delta.key).to_string())
  //     .set("account", Hex(&delta.new_value.account).to_string())
  //     .set("block", clock.number.to_string())
  //     .set("ordinal", delta.ordinal.to_string());
  // }

  Ok(tables.to_database_changes())
}
