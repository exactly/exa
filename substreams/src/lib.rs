use contracts::{auditor::events as auditor_events, is_auditor, is_market, market::events};
use proto::exa::{
  events::{
    AccumulatorAccrual, Borrow, BorrowAtMaturity, EarningsAccumulatorSmoothFactorSet, FixedEarningsUpdate,
    FloatingDebtUpdate, InterestRateModelSet, MarketEntered, MarketExited, MarketUpdate, MaxFuturePoolsSet, Repay,
    RepayAtMaturity, Transfer, TreasurySet,
  },
  Events,
};
use substreams::{
  errors::Error,
  hex,
  key::segment_at,
  pb::substreams::Clock,
  scalar::BigInt,
  store::{DeltaBigInt, DeltaInt64, Deltas, StoreAdd, StoreAddBigInt, StoreNew, StoreSet, StoreSetInt64},
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
    borrow_at_maturities: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::BorrowAtMaturity::match_and_decode(log)) {
        (true, Some(event)) => Some(BorrowAtMaturity {
          market: log.address().to_vec(),
          maturity: event.maturity.to_u64(),
          borrower: event.borrower.to_vec(),
          assets: event.assets.to_string(),
          fee: event.fee.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    borrows: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::Borrow::match_and_decode(log)) {
        (true, Some(event)) => Some(Borrow {
          market: log.address().to_vec(),
          borrower: event.borrower.to_vec(),
          shares: event.shares.to_string(),
          log_ordinal: log.ordinal(),
        }),
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
    market_enters: block
      .logs()
      .filter_map(|log| match (is_auditor(log.address()), auditor_events::MarketEntered::match_and_decode(log)) {
        (true, Some(event)) => Some(MarketEntered {
          market: event.market.to_vec(),
          account: event.account.to_vec(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    market_exits: block
      .logs()
      .filter_map(|log| match (is_auditor(log.address()), auditor_events::MarketExited::match_and_decode(log)) {
        (true, Some(event)) => Some(MarketExited {
          market: event.market.to_vec(),
          account: event.account.to_vec(),
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
    repay_at_maturities: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::RepayAtMaturity::match_and_decode(log)) {
        (true, Some(event)) => Some(RepayAtMaturity {
          market: log.address().to_vec(),
          maturity: event.maturity.to_u64(),
          borrower: event.borrower.to_vec(),
          assets: event.assets.to_string(),
          position_assets: event.position_assets.to_string(),
          log_ordinal: log.ordinal(),
        }),
        _ => None,
      })
      .collect(),
    repays: block
      .logs()
      .filter_map(|log| match (is_market(log.address()), events::Repay::match_and_decode(log)) {
        (true, Some(event)) => Some(Repay {
          market: log.address().to_vec(),
          borrower: event.borrower.to_vec(),
          shares: event.shares.to_string(),
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
pub fn store_borrow_shares(events: Events, output: StoreAddBigInt) {
  for borrow in events.borrows {
    output.add(
      borrow.log_ordinal,
      format!("{market}:{account}", market = Hex(&borrow.market), account = Hex(&borrow.borrower)),
      &BigInt::try_from(borrow.shares.clone()).unwrap(),
    );
  }
  for repay in events.repays {
    output.add(
      repay.log_ordinal,
      format!("{market}:{account}", market = Hex(&repay.market), account = Hex(&repay.borrower)),
      &BigInt::try_from(repay.shares.clone()).unwrap().neg(),
    );
  }
}

#[substreams::handlers::store]
pub fn store_deposit_shares(events: Events, output: StoreAddBigInt) {
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

#[substreams::handlers::store]
pub fn store_fixed_borrows(events: Events, output: StoreAddBigInt) {
  for borrow_at_maturity in events.borrow_at_maturities {
    output.add(
      borrow_at_maturity.log_ordinal,
      format!(
        "{market}:{maturity}:{borrower}",
        market = Hex(&borrow_at_maturity.market),
        maturity = borrow_at_maturity.maturity,
        borrower = Hex(&borrow_at_maturity.borrower)
      ),
      &BigInt::try_from(borrow_at_maturity.assets.clone()).unwrap()
        + &BigInt::try_from(borrow_at_maturity.fee.clone()).unwrap(),
    );
  }
  for repay_at_maturity in events.repay_at_maturities {
    output.add(
      repay_at_maturity.log_ordinal,
      format!(
        "{market}:{maturity}:{borrower}",
        market = Hex(&repay_at_maturity.market),
        maturity = repay_at_maturity.maturity,
        borrower = Hex(&repay_at_maturity.borrower)
      ),
      &BigInt::try_from(repay_at_maturity.position_assets.clone()).unwrap().neg(),
    );
  }
}

#[substreams::handlers::store]
pub fn store_market_enters(events: Events, output: StoreSetInt64) {
  for market_entered in events.market_enters {
    output.set(
      market_entered.log_ordinal,
      format!("{market}:{account}", market = Hex(&market_entered.market), account = Hex(&market_entered.account)),
      &1,
    );
  }
  for market_exited in events.market_exits {
    output.set(
      market_exited.log_ordinal,
      format!("{market}:{account}", market = Hex(&market_exited.market), account = Hex(&market_exited.account)),
      &0,
    );
  }
}

#[substreams::handlers::map]
pub fn db_out(
  clock: Clock,
  events: Events,
  borrow_shares: Deltas<DeltaBigInt>,
  deposit_shares: Deltas<DeltaBigInt>,
  fixed_borrows: Deltas<DeltaBigInt>,
  market_enters: Deltas<DeltaInt64>,
) -> Result<DatabaseChanges, Error> {
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
  for delta in borrow_shares.iter() {
    tables
      .create_row(
        "borrow_shares",
        [
          ("market", segment_at(&delta.key, 0)),
          ("borrower", segment_at(&delta.key, 1)),
          ("block", &clock.number.to_string()),
          ("ordinal", &delta.ordinal.to_string()),
        ],
      )
      .set("shares", delta.new_value.to_string());
  }
  for delta in market_enters.iter() {
    tables
      .create_row(
        "market_enters",
        [
          ("market", segment_at(&delta.key, 0)),
          ("account", segment_at(&delta.key, 1)),
          ("block", &clock.number.to_string()),
          ("ordinal", &delta.ordinal.to_string()),
        ],
      )
      .set("entered", delta.new_value.to_string());
  }
  for delta in deposit_shares.iter() {
    tables
      .create_row(
        "deposit_shares",
        [
          ("market", segment_at(&delta.key, 0)),
          ("account", segment_at(&delta.key, 1)),
          ("block", &clock.number.to_string()),
          ("ordinal", &delta.ordinal.to_string()),
        ],
      )
      .set("shares", delta.new_value.to_string());
  }
  for delta in fixed_borrows.iter() {
    tables
      .create_row(
        "fixed_borrows",
        [
          ("market", segment_at(&delta.key, 0)),
          ("maturity", segment_at(&delta.key, 1)),
          ("borrower", segment_at(&delta.key, 2)),
          ("block", &clock.number.to_string()),
          ("ordinal", &delta.ordinal.to_string()),
        ],
      )
      .set("position_assets", delta.new_value.to_string());
  }
  Ok(tables.to_database_changes())
}
