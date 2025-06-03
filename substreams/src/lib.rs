use abi::factory::events::ExaAccountInitialized;
use proto::exa::{Account, Accounts};
use substreams::{
  errors::Error,
  hex,
  store::{StoreNew, StoreSet, StoreSetProto},
  Hex,
};
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
