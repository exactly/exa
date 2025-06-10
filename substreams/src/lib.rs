use contracts::{is_market, market::events};
use proto::exa::{
  events::{
    AccumulatorAccrual, EarningsAccumulatorSmoothFactorSet, FixedEarningsUpdate, FloatingDebtUpdate,
    InterestRateModelSet, MarketUpdate, MaxFuturePoolsSet, Transfer, TreasurySet,
  },
  Events,
};
use substreams::{
  errors::Error,
  hex,
  key::segment_at,
  pb::substreams::Clock,
  scalar::BigInt,
  store::{DeltaBigInt, Deltas, StoreAdd, StoreAddBigInt, StoreNew},
  Hex,
};
use substreams_database_change::{pb::database::DatabaseChanges, tables::Tables};
use substreams_ethereum::{pb::eth::v2::Block, Event};

mod contracts;
mod proto;

#[substreams::handlers::map]
pub fn map_blocks(block: Block) -> Result<Events, Error> {
  Ok(Events {
    accumulator_accruals: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::AccumulatorAccrual::match_and_decode(log)) {
        (true, Some(_)) => Some(AccumulatorAccrual { market: log.address().to_vec(), log_ordinal: log.ordinal() }),
        _ => None,
      })
      .collect(),
    earnings_accumulator_smooth_factor_sets: block
      .logs()
      .filter_map(|log| {
        match (is_market(log.address()), events::EarningsAccumulatorSmoothFactorSet::match_and_decode(log)) {
          (true, Some(event)) => Some(EarningsAccumulatorSmoothFactorSet {
            market: log.address().to_vec(),
            earnings_accumulator_smooth_factor: event.earnings_accumulator_smooth_factor.to_string(),
            log_ordinal: log.ordinal(),
          }),
          _ => None,
        }
      })
      .collect(),
    fixed_earnings_updates: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::FixedEarningsUpdate::match_and_decode(log)) {
        (true, Some(event)) => Some(FixedEarningsUpdate {
          market: log.address().to_vec(),
          maturity: event.maturity.to_u64(),
          unassigned_earnings: event.unassigned_earnings.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    floating_debt_updates: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::FloatingDebtUpdate::match_and_decode(log)) {
        (true, Some(event)) => Some(FloatingDebtUpdate {
          market: log.address().to_vec(),
          utilization: event.utilization.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    interest_rate_model_sets: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::InterestRateModelSet::match_and_decode(log)) {
        (true, Some(event)) => Some(InterestRateModelSet {
          market: log.address().to_vec(),
          interest_rate_model: event.interest_rate_model.to_vec(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    market_updates: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::MarketUpdate::match_and_decode(log)) {
        (true, Some(event)) => Some(MarketUpdate {
          market: log.address().to_vec(),
          floating_deposit_shares: event.floating_deposit_shares.to_string(),
          floating_assets: event.floating_assets.to_string(),
          floating_borrow_shares: event.floating_borrow_shares.to_string(),
          floating_debt: event.floating_debt.to_string(),
          earnings_accumulator: event.earnings_accumulator.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    max_future_pools_sets: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::MaxFuturePoolsSet::match_and_decode(log)) {
        (true, Some(event)) => Some(MaxFuturePoolsSet {
          market: log.address().to_vec(),
          max_future_pools: event.max_future_pools.to_u64(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    transfers: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::Transfer::match_and_decode(log)) {
        (true, Some(event)) => Some(Transfer {
          token: log.address().to_vec(),
          from: event.from.to_vec(),
          to: event.to.to_vec(),
          amount: event.amount.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    treasury_sets: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::TreasurySet::match_and_decode(log)) {
        (true, Some(event)) => Some(TreasurySet {
          market: log.address().to_vec(),
          treasury: event.treasury.to_vec(),
          treasury_fee_rate: event.treasury_fee_rate.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
  })
}

#[substreams::handlers::store]
pub fn store_account_shares(events: Events, output: StoreAddBigInt) {
  for transfer in events.transfers {
    if transfer.to != hex!("0000000000000000000000000000000000000000") {
      output.add(
        transfer.log_ordinal,
        format!("{market}:{account}", market = Hex(&transfer.token), account = Hex(&transfer.to)),
        &BigInt::try_from(transfer.amount.clone()).unwrap(),
      );
    }
    if transfer.from != hex!("0000000000000000000000000000000000000000") {
      output.add(
        transfer.log_ordinal,
        format!("{market}:{account}", market = Hex(&transfer.token), account = Hex(&transfer.from)),
        &BigInt::try_from(transfer.amount.clone()).unwrap().neg(),
      );
    }
  }
}

#[substreams::handlers::map]
pub fn db_out(clock: Clock, events: Events, account_shares: Deltas<DeltaBigInt>) -> Result<DatabaseChanges, Error> {
  let mut tables = Tables::new();
  tables
    .create_row("blocks", clock.number.to_string())
    .set("timestamp", clock.timestamp.unwrap_or_default().seconds.to_string());
  for accumulator_accrual in events.accumulator_accruals {
    tables.create_row(
      "accumulator_accruals",
      [
        ("market", Hex(&accumulator_accrual.market).to_string()),
        ("block", clock.number.to_string()),
        ("ordinal", accumulator_accrual.log_ordinal.to_string()),
      ],
    );
  }
  for earnings_accumulator_smooth_factor_set in events.earnings_accumulator_smooth_factor_sets {
    tables
      .create_row(
        "earnings_accumulator_smooth_factors",
        [
          ("market", Hex(&earnings_accumulator_smooth_factor_set.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", earnings_accumulator_smooth_factor_set.log_ordinal.to_string()),
        ],
      )
      .set(
        "earnings_accumulator_smooth_factor",
        earnings_accumulator_smooth_factor_set.earnings_accumulator_smooth_factor.to_string(),
      );
  }
  for fixed_earnings_update in events.fixed_earnings_updates {
    tables
      .create_row(
        "fixed_earnings_updates",
        [
          ("market", Hex(&fixed_earnings_update.market).to_string()),
          ("maturity", fixed_earnings_update.maturity.to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", fixed_earnings_update.log_ordinal.to_string()),
        ],
      )
      .set("unassigned_earnings", fixed_earnings_update.unassigned_earnings.to_string());
  }
  for floating_debt_update in events.floating_debt_updates {
    tables
      .create_row(
        "floating_debt_updates",
        [
          ("market", Hex(&floating_debt_update.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", floating_debt_update.log_ordinal.to_string()),
        ],
      )
      .set("utilization", floating_debt_update.utilization.to_string());
  }
  for interest_rate_model_set in events.interest_rate_model_sets {
    tables
      .create_row(
        "interest_rate_models",
        [
          ("market", Hex(&interest_rate_model_set.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", interest_rate_model_set.log_ordinal.to_string()),
        ],
      )
      .set("address", Hex(&interest_rate_model_set.interest_rate_model).to_string());
  }
  for market_update in events.market_updates {
    tables
      .create_row(
        "market_updates",
        [
          ("market", Hex(&market_update.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", market_update.log_ordinal.to_string()),
        ],
      )
      .set("floating_deposit_shares", &market_update.floating_deposit_shares)
      .set("floating_assets", &market_update.floating_assets)
      .set("floating_borrow_shares", &market_update.floating_borrow_shares)
      .set("floating_debt", &market_update.floating_debt)
      .set("earnings_accumulator", &market_update.earnings_accumulator);
  }
  for max_future_pool_set in events.max_future_pools_sets {
    tables
      .create_row(
        "max_future_pools",
        [
          ("market", Hex(&max_future_pool_set.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", max_future_pool_set.log_ordinal.to_string()),
        ],
      )
      .set("max_future_pools", max_future_pool_set.max_future_pools.to_string());
  }
  for treasury_set in events.treasury_sets {
    tables
      .create_row(
        "treasuries",
        [
          ("market", Hex(&treasury_set.market).to_string()),
          ("block", clock.number.to_string()),
          ("ordinal", treasury_set.log_ordinal.to_string()),
        ],
      )
      .set("treasury", Hex(&treasury_set.treasury).to_string())
      .set("treasury_fee_rate", treasury_set.treasury_fee_rate.to_string());
  }
  for delta in account_shares.iter() {
    tables
      .create_row(
        "shares",
        [
          ("market", segment_at(&delta.key, 0)),
          ("account", segment_at(&delta.key, 1)),
          ("block", &clock.number.to_string()),
          ("ordinal", &delta.ordinal.to_string()),
        ],
      )
      .set("amount", delta.new_value.to_string());
  }
  Ok(tables.to_database_changes())
}
