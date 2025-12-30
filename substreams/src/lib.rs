#![expect(clippy::not_unsafe_ptr_arg_deref)]

use serde::Deserialize;
use substreams::{
  Hex,
  errors::Error,
  store::{StoreNew, StoreSet, StoreSetInt64},
};
use substreams_ethereum::pb::eth::v2::Block;

use crate::{contracts::factory::events::ExaAccountInitialized, proto::exa::Accounts};

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
