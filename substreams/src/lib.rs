use abi::{entrypoint::events::AccountDeployed, erc20::events::Transfer};
use pb::exa;
use substreams::{
  errors::Error,
  hex,
  store::{StoreGet, StoreGetProto, StoreNew, StoreSet, StoreSetProto},
  Hex,
};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod abi;
#[allow(clippy::all)]
mod pb;

#[substreams::handlers::map]
pub fn map_accounts(block: Block) -> Result<exa::Accounts, Error> {
  Ok(exa::Accounts {
    accounts: block
      .logs()
      .filter_map(|log| {
        if log.address() != hex!("5FF137D4b0FDCD49DcA30c7CF57E578a026d2789") {
          return None;
        }
        AccountDeployed::match_and_decode(log).and_then(|event| match event.factory.as_slice() {
          hex!("6E1b5A67adD32E8dC034c23b8022b54821ED297b") => Some(event.sender),
          _ => None,
        })
      })
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_accounts(accounts: exa::Accounts, store: StoreSetProto<Vec<u8>>) {
  for account in accounts.accounts {
    store.set(0, format!("account:{}", Hex(&account)), &account);
  }
}

#[substreams::handlers::map]
pub fn map_transfers(block: Block, store: StoreGetProto<Vec<u8>>) -> Result<exa::Transfers, Error> {
  Ok(exa::Transfers {
    transfers: block
      .logs()
      .filter_map(|log| {
        Transfer::match_and_decode(log).and_then(|event| match store.get_last(format!("account:{}", Hex(&event.to))) {
          Some(receiver) if !event.value.is_zero() => Some(exa::Transfer { asset: log.address().to_vec(), receiver }),
          _ => None,
        })
      })
      .collect(),
  })
}
