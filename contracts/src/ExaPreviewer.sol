// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibString } from "solady/utils/LibString.sol";

import {
  FixedPool,
  IAuditor,
  IExaAccount,
  IMarket,
  IProposalManager,
  MarketData,
  Proposal,
  ProposalType
} from "./IExaAccount.sol";

uint256 constant FIXED_INTERVAL = 4 weeks;

contract ExaPreviewer {
  using FixedPointMathLib for uint256;
  using LibString for string;

  IAuditor public immutable AUDITOR;
  ICollectableMarket public immutable EXA_USDC;
  IProposalManager public immutable PROPOSAL_MANAGER;

  constructor(IAuditor auditor, ICollectableMarket exaUSDC, IProposalManager proposalManager) {
    AUDITOR = auditor;
    EXA_USDC = exaUSDC;
    PROPOSAL_MANAGER = proposalManager;
  }

  function assets() external view returns (Asset[] memory assets_) {
    IMarket[] memory allMarkets = AUDITOR.allMarkets();
    assets_ = new Asset[](allMarkets.length);
    for (uint256 i = 0; i < allMarkets.length; ++i) {
      // slither-disable-next-line calls-loop
      assets_[i] = Asset({ market: address(allMarkets[i]), asset: allMarkets[i].asset() });
    }
  }

  function markets() external view returns (MarketPreview[] memory markets_) {
    IMarket[] memory allMarkets = AUDITOR.allMarkets();
    markets_ = new MarketPreview[](allMarkets.length);
    for (uint256 i = 0; i < allMarkets.length; ++i) {
      // slither-disable-next-line calls-loop
      MarketData memory market = AUDITOR.markets(allMarkets[i]);
      // slither-disable-next-line calls-loop
      markets_[i] = MarketPreview({
        market: address(allMarkets[i]),
        asset: allMarkets[i].asset(),
        decimals: allMarkets[i].decimals(),
        usdPrice: AUDITOR.assetPrice(market.priceFeed),
        symbol: allMarkets[i].symbol().slice(3)
      });
    }
  }

  function pendingProposals(address account) external view returns (PendingProposal[] memory proposals) {
    uint256 queueNonce = PROPOSAL_MANAGER.queueNonces(account);
    uint256 nonce = PROPOSAL_MANAGER.nonces(account);
    uint256 delay = PROPOSAL_MANAGER.delay();
    proposals = new PendingProposal[](queueNonce - nonce);
    for (uint256 i = nonce; i < queueNonce; ++i) {
      // slither-disable-next-line calls-loop
      (uint256 amount, IMarket market, uint256 timestamp, ProposalType proposalType, bytes memory data) =
        PROPOSAL_MANAGER.proposals(account, i);
      proposals[i - nonce] = PendingProposal({
        nonce: i,
        unlock: timestamp + delay,
        proposal: Proposal({
          amount: amount, market: market, timestamp: timestamp, proposalType: proposalType, data: data
        })
      });
    }
  }

  function collectCredit(
    uint256 maturity,
    uint256 amount,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external {
    IExaAccount(msg.sender).collectCredit(maturity, amount, maxRepay, timestamp, signature);
    _checkLiquidity(IExaAccount(msg.sender));
  }

  function collectCollateral(
    uint256 amount,
    IMarket collateral,
    uint256 maxAmountIn,
    uint256 timestamp,
    bytes calldata route,
    bytes calldata signature
  ) external {
    IExaAccount(msg.sender).collectCollateral(amount, collateral, maxAmountIn, timestamp, route, signature);
    _checkLiquidity(IExaAccount(msg.sender));
  }

  function collectDebit(uint256 amount, uint256 timestamp, bytes calldata signature) external {
    IExaAccount(msg.sender).collectDebit(amount, timestamp, signature);
    _checkLiquidity(IExaAccount(msg.sender));
  }

  function collectInstallments(
    uint256 firstMaturity,
    uint256[] calldata amounts,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external {
    IExaAccount(msg.sender).collectInstallments(firstMaturity, amounts, maxRepay, timestamp, signature);
    _checkLiquidity(IExaAccount(msg.sender));
  }

  function utilizations() external view returns (Utilizations memory) {
    uint256 floatingAssets = EXA_USDC.floatingAssets();
    uint256 floatingDebt = EXA_USDC.floatingDebt();
    uint256 backupBorrowed = EXA_USDC.floatingBackupBorrowed();
    FixedUtilization[] memory fixedUtilizations = new FixedUtilization[](EXA_USDC.maxFuturePools());
    for (uint256 i = 0; i < fixedUtilizations.length; ++i) {
      // slither-disable-next-line weak-prng
      uint256 maturity = block.timestamp + (i + 1) * FIXED_INTERVAL - (block.timestamp % FIXED_INTERVAL);
      // slither-disable-next-line calls-loop
      FixedPool memory pool = EXA_USDC.fixedPools(maturity);
      fixedUtilizations[i] = FixedUtilization({
        maturity: maturity,
        utilization: floatingAssets != 0 && pool.borrowed > pool.supplied
          ? (pool.borrowed - pool.supplied).divWadUp(floatingAssets)
          : 0
      });
    }
    return Utilizations({
      floatingAssets: floatingAssets,
      globalUtilization: floatingAssets != 0 ? (floatingDebt + backupBorrowed).divWadUp(floatingAssets) : 0,
      floatingUtilization: floatingAssets != 0 ? floatingDebt.divWadUp(floatingAssets) : 0,
      fixedUtilizations: fixedUtilizations,
      interestRateModel: EXA_USDC.interestRateModel().parameters()
    });
  }

  function _checkLiquidity(IExaAccount account) internal view {
    PROPOSAL_MANAGER.checkLiquidity(address(account));
  }
}

interface ICollectableMarket is IMarket {
  function floatingAssets() external view returns (uint256);
  function floatingBackupBorrowed() external view returns (uint256);
  function floatingDebt() external view returns (uint256);
  function interestRateModel() external view returns (IInterestRateModel);
  function maxFuturePools() external view returns (uint256);
}

interface IInterestRateModel {
  function parameters() external view returns (IRMParameters memory);
}

struct Asset {
  address market;
  address asset;
}

struct MarketPreview {
  address market;
  address asset;
  uint8 decimals;
  uint256 usdPrice;
  string symbol;
}

struct Utilizations {
  uint256 floatingAssets;
  uint256 globalUtilization;
  uint256 floatingUtilization;
  FixedUtilization[] fixedUtilizations;
  IRMParameters interestRateModel;
}

struct FixedUtilization {
  uint256 maturity;
  uint256 utilization;
}

struct IRMParameters {
  uint256 minRate;
  uint256 naturalRate;
  uint256 maxUtilization;
  uint256 naturalUtilization;
  uint256 growthSpeed;
  uint256 sigmoidSpeed;
  uint256 spreadFactor;
  uint256 maturitySpeed;
  int256 timePreference;
  uint256 fixedAllocation;
  uint256 maxRate;
}

struct PendingProposal {
  uint256 nonce;
  uint256 unlock;
  Proposal proposal;
}
