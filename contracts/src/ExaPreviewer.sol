// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibString } from "solady/utils/LibString.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
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

  constructor(IAuditor auditor, ICollectableMarket exaUSDC) {
    AUDITOR = auditor;
    EXA_USDC = exaUSDC;
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
    if (account.code.length == 0) return proposals;
    IProposalManager proposalManager = _proposalManager(account);
    if (address(proposalManager) == address(0)) return proposals;
    uint256 queueNonce = proposalManager.queueNonces(account);
    uint256 nonce = proposalManager.nonces(account);
    uint256 delay = proposalManager.delay();
    proposals = new PendingProposal[](queueNonce - nonce);
    for (uint256 i = nonce; i < queueNonce; ++i) {
      // slither-disable-next-line calls-loop
      (uint256 amount, IMarket market, uint256 timestamp, ProposalType proposalType, bytes memory data) =
        proposalManager.proposals(account, i);
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
    _checkLiquidity(msg.sender);
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
    _checkLiquidity(msg.sender);
  }

  function collectDebit(uint256 amount, uint256 timestamp, bytes calldata signature) external {
    IExaAccount(msg.sender).collectDebit(amount, timestamp, signature);
    _checkLiquidity(msg.sender);
  }

  function collectInstallments(
    uint256 firstMaturity,
    uint256[] calldata amounts,
    uint256 maxRepay,
    uint256 timestamp,
    bytes calldata signature
  ) external {
    IExaAccount(msg.sender).collectInstallments(firstMaturity, amounts, maxRepay, timestamp, signature);
    _checkLiquidity(msg.sender);
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

  function _checkLiquidity(address account) internal view {
    _proposalManager(account).checkLiquidity(account);
  }

  function _proposalManager(address account) internal view returns (IProposalManager proposalManager) {
    try IAccountLoupe(account).getExecutionFunctionConfig(IExaAccount.propose.selector) returns (
      IAccountLoupe.ExecutionFunctionConfig memory config
    ) {
      if (config.plugin.code.length == 0) return proposalManager;
      try ExaPlugin(payable(config.plugin)).proposalManager() returns (IProposalManager manager) {
        return manager;
      } catch { } // solhint-disable-line no-empty-blocks
    } catch { } // solhint-disable-line no-empty-blocks
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
