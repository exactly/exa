use std::{collections::HashMap, str::FromStr};

use abi::{factory::events::ExaAccountInitialized, lifi::events::LiFiGenericSwapCompleted, market::events::Transfer};
use proto::exa::{Account, Accounts, Swap, Swaps};
use substreams::{
  errors::Error,
  hex,
  scalar::BigInt,
  store::{StoreGet, StoreGetProto, StoreNew, StoreSet, StoreSetProto},
  Hex,
};
use substreams_database_change::pb::database::{table_change::Operation, DatabaseChanges, Field, TableChange};
use substreams_ethereum::{pb::eth::v2::Block, Event};

use crate::proto::exa::AccountMarket;

mod abi;
#[allow(clippy::all)]
mod proto;

fn is_market(address: &[u8]) -> bool {
  const MARKET_ADDRESSES: [&[u8]; 6] = [
    &hex!("6926B434CCe9b5b7966aE1BfEef6D0A7DCF3A8bb"),
    &hex!("81C9A7B55A4df39A9B7B5F781ec0e53539694873"),
    &hex!("c4d4500326981eacD020e20A81b1c479c161c7EF"),
    &hex!("22ab31Cd55130435b5efBf9224b6a9d5EC36533F"),
    &hex!("6f748FD65d7c71949BA6641B3248C4C191F3b322"),
    &hex!("a430A427bd00210506589906a71B54d6C256CEdb"),
  ];
  MARKET_ADDRESSES.iter().any(|&market_address| market_address == address)
}

fn is_factory(address: &[u8]) -> bool {
  const FACTORY_ADDRESSES: [&[u8]; 4] = [
    &hex!("8D493AF799162Ac3f273e8918B2842447f702163"),
    &hex!("3427a595eD6E05Cc2D8115e28BAd151cB879616e"),
    &hex!("cbeaAF42Cc39c17e84cBeFe85160995B515A9668"),
    &hex!("961EbA47650e2198A959Ef5f337E542df5E4F61b"),
  ];
  FACTORY_ADDRESSES.iter().any(|&factory_address| factory_address == address)
}

#[substreams::handlers::map]
pub fn map_accounts(block: Block) -> Result<Accounts, Error> {
  let accounts = block
    .logs()
    .filter_map(|log| {
      let address = log.address();
      let mut account: Option<Account> = None;
      if is_market(&address) {
        if let Some(event) = Transfer::match_and_decode(log) {
          if event.to != hex!("0000000000000000000000000000000000000000") {
            account = accounts_store.get_last(&format!("account:{}", Hex(&event.to))).map(|_| Account {
              address: event.to.to_vec(),
              exa: false,
              markets: HashMap::new(),
              log_ordinal: log.ordinal(),
            });

            println!("received shares");
            println!("account: {:?}", account);
            if let Some(mut account) = account {
              if let Some(market) = account.markets.get_mut(&Hex(&address).to_string()) {
                let current_shares = BigInt::from_str(&market.shares).unwrap_or(BigInt::zero());
                market.shares = (current_shares + event.amount).to_string();
              } else {
                account.markets.insert(Hex(&address).to_string(), AccountMarket { shares: event.amount.to_string() });
              }
              return Some(account);
            }
          }
          if event.from != hex!("0000000000000000000000000000000000000000") {
            account = accounts_store.get_last(&format!("account:{}", Hex(&event.from))).map(|_| Account {
              address: event.from.to_vec(),
              exa: false,
              markets: HashMap::new(),
              log_ordinal: log.ordinal(),
            });
            println!("sent shares");
            println!("account: {:?}", account);
            if let Some(mut account) = account {
              match account.markets.get_mut(&Hex(&address).to_string()) {
                Some(market) => {
                  let current_shares = BigInt::from_str(&market.shares).unwrap_or(BigInt::zero());
                  market.shares = (current_shares - event.amount).to_string();
                }
                _ => (),
              }
              return Some(account);
            }
          }
        }
      }
      if is_factory(&address) {
        if let Some(event) = ExaAccountInitialized::match_and_decode(log) {
          account = accounts_store.get_last(&format!("account:{}", Hex(&event.account))).map(|_| Account {
            address: event.account.to_vec(),
            exa: true,
            markets: HashMap::new(),
            log_ordinal: log.ordinal(),
          });
          if let Some(account) = account {
            return Some(account);
          }
        }
      }
      account
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
