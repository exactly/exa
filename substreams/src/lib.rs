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

macro_rules! is_factory {
  ($address:expr) => {
    match option_env!("CHAIN_ID") {
      // optimism
      Some("10") => {
        $address == hex!("8D493AF799162Ac3f273e8918B2842447f702163")
          || $address == hex!("3427a595eD6E05Cc2D8115e28BAd151cB879616e")
          || $address == hex!("cbeaAF42Cc39c17e84cBeFe85160995B515A9668")
          || $address == hex!("961EbA47650e2198A959Ef5f337E542df5E4F61b")
      }
      // op-sepolia
      _ => {
        $address == $address == hex!("9cCab24277a9E6be126Df3A563c90B4eBf6D5e26")
          || $address == hex!("98b3E5C7a039A329a4446A3FACB860C506B28901")
          || $address == hex!("8cA9Bb05f6a9CDf3412d64C25907358686277E5c")
          || $address == hex!("086E2e36a98d266c81E453f0129ec01A34e64cF9")
          || $address == hex!("8D493AF799162Ac3f273e8918B2842447f702163")
          || $address == hex!("b312816855ca94d8fb4Cbea9E63BD6b12353AfBe")
          || $address == hex!("cE820eea73585E62347db9E1DA3aa804Ba7c3863")
          || $address == hex!("5B710958D215F7951ec67e1bb13077F5fBB3a3F1")
          || $address == hex!("Fe619D955F5bfbf810b93315A340eE32d288BB63")
          || $address == hex!("861337355FE34cF70bcC586F276a0151E7F5Beba")
          || $address == hex!("3F62562c6f2aD9A623cb5fceD48053c691F95228")
          || $address == hex!("FC86cc5aE0FbE173fe385114F5F0a9C4Afe60B6F")
          || $address == hex!("98d3E8B291d9E89C25D8371b7e8fFa8BC32E0aEC")
      }
    }
  };
}

#[substreams::handlers::map]
pub fn map_accounts(block: Block) -> Result<Accounts, Error> {
  let accounts = block
    .logs()
    .filter_map(|log| match (is_factory!(log.address()), ExaAccountInitialized::match_and_decode(log)) {
      (true, Some(event)) => Some(Account { address: event.account.to_vec(), log_ordinal: log.ordinal() }),
      _ => None,
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

macro_rules! is_swapper {
  ($address:expr) => {
    match option_env!("CHAIN_ID") {
      Some("11155420") | Some("") | None => $address == hex!("3E2D4b69C52932CB5b2a9Ee744CB585bb201c771"), // op-sepolia
      _ => $address == hex!("1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE"),                                  // lifi
    }
  };
}

#[substreams::handlers::map]
pub fn map_swaps(block: Block, store: StoreGetProto<Account>) -> Result<Swaps, Error> {
  Ok(Swaps {
    swaps: block
      .logs()
      .filter_map(|log| {
        LiFiGenericSwapCompleted::match_and_decode(log).and_then(|event| {
          match (is_swapper!(log.address()), store.get_last(format!("account:{}", Hex(&event.receiver)))) {
            (true, Some(_)) => Some(Swap {
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
