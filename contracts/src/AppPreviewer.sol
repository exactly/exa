// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibCall } from "solady/utils/LibCall.sol";
import { LibString } from "solady/utils/LibString.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import { IAuditor, IExaAccount, IMarket, IProposalManager, MarketData } from "./IExaAccount.sol";

contract AppPreviewer {
  using LibString for string;

  function preview(
    address account,
    IAuditor auditor,
    address previewer,
    address ratePreviewer,
    IMarket averageMarket,
    address[] calldata targets
  ) external view returns (NetworkPreview memory preview_) {
    preview_.timestamp = block.timestamp;
    preview_.balance = account.balance;
    if (address(auditor) != address(0)) {
      preview_.markets = markets(auditor);
      preview_.balances = new uint256[](preview_.markets.length);
      for (uint256 i = 0; i < preview_.markets.length; ++i) {
        // slither-disable-next-line calls-loop
        preview_.balances[i] = IERC20(preview_.markets[i].asset).balanceOf(account); // forge-lint: disable-line(calls-loop)
      }
    }
    if (previewer != address(0)) {
      preview_.exactly = LibCall.staticCallContract(previewer, abi.encodeWithSignature("exactly(address)", account));
    }
    if (ratePreviewer != address(0)) {
      // slither-disable-next-line low-level-calls
      (bool success, bytes memory snapshot) = ratePreviewer.staticcall(abi.encodeWithSignature("snapshot()"));
      if (success) preview_.snapshot = snapshot;
    }
    if (address(averageMarket) != address(0)) {
      preview_.floatingAssetsAverage = averageMarket.previewFloatingAssetsAverage();
    }
    preview_.proposalManager = proposalManager(account);
    preview_.allowed = new bool[](targets.length);
    if (preview_.proposalManager.proposalManager == address(0)) return preview_;
    IProposalManager proposalManager_ = IProposalManager(preview_.proposalManager.proposalManager);
    for (uint256 i = 0; i < targets.length; ++i) {
      // slither-disable-next-line calls-loop
      preview_.allowed[i] = proposalManager_.allowlist(targets[i]); // forge-lint: disable-line(calls-loop)
    }
  }

  function markets(IAuditor auditor) public view returns (MarketPreview[] memory markets_) {
    IMarket[] memory allMarkets = auditor.allMarkets();
    markets_ = new MarketPreview[](allMarkets.length);
    for (uint256 i = 0; i < allMarkets.length; ++i) {
      IMarket market = allMarkets[i];
      // slither-disable-next-line calls-loop
      bytes memory data = LibCall.staticCallContract(address(auditor), abi.encodeCall(IAuditor.markets, (market)));
      // forge-lint: disable-start(calls-loop)
      // slither-disable-next-line calls-loop
      markets_[i] = MarketPreview({
        market: address(market),
        asset: market.asset(),
        decimals: market.decimals(),
        nonCollateral: data.length > 5 * 32 && LibBytes.load(data, 5 * 32) != 0,
        isFrozen: market.isFrozen(),
        usdPrice: auditor.assetPrice(abi.decode(data, (MarketData)).priceFeed),
        symbol: market.symbol().slice(3)
      });
      // forge-lint: disable-end(calls-loop)
    }
  }

  function proposalManager(address account) public view returns (ProposalManagerPreview memory preview_) {
    if (account.code.length == 0) return preview_;
    try IAccountLoupe(account).getExecutionFunctionConfig(IExaAccount.propose.selector) returns (
      IAccountLoupe.ExecutionFunctionConfig memory config
    ) {
      if (config.plugin.code.length == 0) return preview_;
      try ExaPlugin(payable(config.plugin)).proposalManager() returns (IProposalManager proposalManager_) {
        return ProposalManagerPreview({
          proposalManager: address(proposalManager_),
          delay: proposalManager_.delay(),
          queueNonce: proposalManager_.queueNonces(account),
          nonce: proposalManager_.nonces(account)
        });
      } catch { } // solhint-disable-line no-empty-blocks
    } catch { } // solhint-disable-line no-empty-blocks
  }
}

struct MarketPreview {
  address market;
  address asset;
  uint8 decimals;
  bool nonCollateral;
  bool isFrozen;
  uint256 usdPrice;
  string symbol;
}

struct NetworkPreview {
  MarketPreview[] markets;
  bytes exactly;
  bytes snapshot;
  uint256 timestamp;
  uint256 floatingAssetsAverage;
  ProposalManagerPreview proposalManager;
  bool[] allowed;
  uint256 balance;
  uint256[] balances;
}

struct ProposalManagerPreview {
  address proposalManager;
  uint256 delay;
  uint256 queueNonce;
  uint256 nonce;
}
