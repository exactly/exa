use abi::{
  entrypoint::events::AccountDeployed, erc20::events::Transfer, lifi::events::LiFiGenericSwapCompleted,
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
mod proto;

// const MARKET_WETH: [u8; 20] = hex!("c4d4500326981eacD020e20A81b1c479c161c7EF");
// const MARKET_USDC: [u8; 20] = hex!("6926B434CCe9b5b7966aE1BfEef6D0A7DCF3A8bb");
// const MARKET_USDCE: [u8; 20] = hex!("7F5c764cBc14f9669B88837ca1490cCa17c31607");
// const MARKET_WSTETH: [u8; 20] = hex!("22ab31Cd55130435b5efBf9224b6a9d5EC36533F");
// const MARKET_WBTC: [u8; 20] = hex!("6f748FD65d7c71949BA6641B3248C4C191F3b322");
// const MARKET_OP: [u8; 20] = hex!("a430A427bd00210506589906a71B54d6C256CEdb");
// const MARKETS: [[u8; 20]; 6] = [MARKET_WETH, MARKET_USDC, MARKET_USDCE, MARKET_WSTETH, MARKET_WBTC, MARKET_OP];

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
          if log.address().to_vec() == hex!("c4d4500326981eacD020e20A81b1c479c161c7EF") {
            Some(exa::Deposit {
              market: log.address().to_vec(),
              receiver: event.owner.to_vec(),
              amount: event.assets.to_string(),
              block_number: block.number,
              tx_index: log.receipt.transaction.index as u64,
              log_index: log.index() as u64,
            })
          } else {
            None
          }
        })
      })
      .collect(),
  })
}

#[substreams::handlers::map]
pub fn map_swaps(block: Block) -> Result<exa::Swaps, Error> {
  const LIFI_CONTRACT_ADDRESS: [u8; 20] = hex!("1231deb6f5749ef6ce6943a275a1d3e7486f4eae");

  Ok(exa::Swaps {
    swaps: block
      .logs()
      .filter(|log| log.address() == LIFI_CONTRACT_ADDRESS)
      .filter_map(|log| {
        LiFiGenericSwapCompleted::match_and_decode(log).and_then(|event| {
          Some(exa::Swap {
            receiver: event.receiver.to_vec(),
            asset_from: event.from_asset_id.to_vec(),
            asset_to: event.to_asset_id.to_vec(),
            amount_from: event.from_amount.to_string(),
            amount_to: event.to_amount.to_string(),
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
pub fn db_swaps(swaps: exa::Swaps) -> Result<DatabaseChanges, Error> {
  substreams::log::info!("hey!");
  let mut changes = vec![];
  for swap in swaps.swaps {
    let mut change = TableChange::new(
      "swaps",
      format!("{}_{}_{}", swap.block_number, swap.tx_index, swap.log_index),
      0,
      Operation::Create,
    );
    change.fields.push(Field {
      name: "receiver".to_string(),
      new_value: Hex(&swap.receiver).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "from_asset_id".to_string(),
      new_value: Hex(&swap.asset_from).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "to_asset_id".to_string(),
      new_value: Hex(&swap.asset_to).to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "from_amount".to_string(),
      new_value: swap.amount_from.to_string(),
      old_value: "".to_string(),
    });
    change.fields.push(Field {
      name: "to_amount".to_string(),
      new_value: swap.amount_to.to_string(),
      old_value: "".to_string(),
    });
    changes.push(change);
  }
  Ok(DatabaseChanges { table_changes: changes })
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
