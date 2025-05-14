use abi::{factory::events::ExaAccountInitialized, lifi::events::LiFiGenericSwapCompleted};
use proto::exa::{Account, Accounts, Swap, Swaps};
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
mod proto;

#[substreams::handlers::map]
pub fn map_accounts(block: Block) -> Result<Accounts, Error> {
  let accounts = block
    .logs()
    .filter_map(|log| {
      let address = log.address();
      if address == hex!("8D493AF799162Ac3f273e8918B2842447f702163")
        || address == hex!("3427a595eD6E05Cc2D8115e28BAd151cB879616e")
        || address == hex!("cbeaAF42Cc39c17e84cBeFe85160995B515A9668")
        || address == hex!("961EbA47650e2198A959Ef5f337E542df5E4F61b")
      {
        ExaAccountInitialized::match_and_decode(log)
          .map(|event| Account { address: event.account.to_vec(), log_ordinal: log.ordinal() })
      } else {
        None
      }
    })
    .collect();
  Ok(Accounts { accounts })
}

#[substreams::handlers::store]
pub fn store_accounts(accounts: Accounts, store: StoreSetProto<Account>) {
  for account in accounts.accounts {
    store.set(account.log_ordinal, format!("account:{}", Hex(&account.address)), &account);
  }
}

#[substreams::handlers::map]
pub fn map_swaps(block: Block, store: StoreGetProto<Account>) -> Result<Swaps, Error> {
  Ok(Swaps {
    swaps: block
      .logs()
      .filter_map(|log| {
        LiFiGenericSwapCompleted::match_and_decode(log).and_then(|event| {
          match (log.address(), store.get_last(format!("account:{}", Hex(&event.receiver)))) {
            (hex!("1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"), Some(_)) => Some(Swap {
              receiver: event.receiver.to_vec(),
              from_asset_id: event.from_asset_id.to_vec(),
              to_asset_id: event.to_asset_id.to_vec(),
              from_amount: event.from_amount.to_string(),
              to_amount: event.to_amount.to_string(),
              transaction_id: event.transaction_id.to_vec(),
              log_ordinal: log.ordinal(),
            }),
            _ => None,
          }
        })
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn db_out(swaps: Swaps) -> Result<DatabaseChanges, Error> {
  let mut changes = vec![];

  for swap in swaps.swaps {
    let mut change = TableChange::new("swaps", format!("{:?}", swap.transaction_id), 0, Operation::Update);

    change.fields.push(Field {
      name: "receiver".to_string(),
      new_value: Hex(&swap.receiver).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "from_amount".to_string(),
      new_value: swap.from_amount.to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "to_amount".to_string(),
      new_value: swap.to_amount.to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "from_asset_id".to_string(),
      new_value: Hex(&swap.from_asset_id).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "to_asset_id".to_string(),
      new_value: Hex(&swap.to_asset_id).to_string(),
      old_value: "".to_string(),
    });
    changes.push(change);
  }

  Ok(DatabaseChanges { table_changes: changes })
}
