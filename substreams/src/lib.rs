use abi::{
  entrypoint::events::AccountDeployed, erc20::events::Transfer, lifi::events::LiFiSwappedGeneric,
  market::events::Deposit,
};
use proto::exa;
use substreams::{
  errors::Error,
  hex,
  store::{StoreGet, StoreGetProto, StoreNew, StoreSet, StoreSetProto},
  Hex,
};
use substreams_database_change::pb::database::{table_change::Operation, DatabaseChanges, Field, TableChange};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod abi;
#[allow(clippy::all)]
#[allow(clippy::all)]
mod proto;

#[substreams::handlers::map]
pub fn map_accounts(block: Block) -> Result<exa::Accounts, Error> {
  let accounts = block
    .logs()
    .filter_map(|log| {
      if log.address() == hex!("5FF137D4b0FDCD49DcA30c7CF57E578a026d2789") {
        AccountDeployed::match_and_decode(log).and_then(|event| {
          if event.factory.as_slice() == hex!("961EbA47650e2198A959Ef5f337E542df5E4F61b") {
            Some(event.sender)
          } else {
            None
          }
        })
      } else {
        None
      }
    })
    .collect();

  Ok(exa::Accounts { accounts })
}

#[substreams::handlers::store]
pub fn store_accounts(accounts: exa::Accounts, store: StoreSetProto<Vec<u8>>) {
  for account in accounts.accounts {
    store.set(0, format!("account:{}", Hex(&account)), &account);
  }
}

#[substreams::handlers::map]
pub fn db_deposits(
  deposits: exa::Deposits,
) -> Result<substreams_database_change::pb::database::DatabaseChanges, Error> {
  let mut changes = vec![];

  for deposit in deposits.deposits {
    let mut change = TableChange::new(
      "deposits",
      format!("{}_{}_{}", deposit.block_number, deposit.tx_index, deposit.log_index),
      0,
      Operation::Create,
    );
    change.fields.push(Field {
      name: "market".to_string(),
      new_value: Hex(&deposit.market).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "receiver".to_string(),
      new_value: Hex(&deposit.receiver).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "amount".to_string(),
      new_value: deposit.amount.to_string(),
      old_value: "".to_string(),
    });
    changes.push(change);
  }

  Ok(DatabaseChanges { table_changes: changes })
}

#[substreams::handlers::map]
pub fn map_deposits(block: Block) -> Result<exa::Deposits, Error> {
  Ok(exa::Deposits {
    deposits: block
      .logs()
      .filter_map(|log| {
        Deposit::match_and_decode(log).and_then(|event| {
          Some(exa::Deposit {
            market: log.address().to_vec(),
            receiver: event.owner.to_vec(),
            amount: event.assets.to_string(),
            block_number: block.number,
            tx_index: log.receipt.transaction.index as u64,
            log_index: log.index() as u64,
          })
        })
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn map_swaps(block: Block) -> Result<exa::Swaps, Error> {
  Ok(exa::Swaps {
    swaps: block
      .logs()
      .filter_map(|log| {
        LiFiSwappedGeneric::match_and_decode(log).and_then(|event| {
          Some(exa::Swap {
            receiver: Default::default(),
            asset_from: event.from_asset_id.to_vec(),
            asset_to: event.to_asset_id.to_vec(),
            amount_from: event.from_amount.to_string(),
            amount_to: event.to_amount.to_string(),
          })
        })
      })
      .collect(),
  })
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

#[substreams::handlers::map]
pub fn map_transfers_all(block: Block) -> Result<exa::Transfers, Error> {
  Ok(exa::Transfers {
    transfers: block
      .logs()
      .filter_map(|log| {
        Transfer::match_and_decode(log)
          .and_then(|event| Some(exa::Transfer { asset: log.address().to_vec(), receiver: event.to.to_vec() }))
      })
      .collect(),
  })
}
