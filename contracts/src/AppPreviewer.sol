// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibCall } from "solady/utils/LibCall.sol";
import { LibString } from "solady/utils/LibString.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import {
  IAuditor,
  IExaAccount,
  IMarket,
  IProposalManager,
  MarketData,
  PendingProposal,
  Proposal,
  ProposalType
} from "./IExaAccount.sol";

contract AppPreviewer {
  using LibString for string;

  function markets(IAuditor auditor) external view returns (MarketPreview[] memory markets_) {
    IMarket[] memory allMarkets = auditor.allMarkets();
    markets_ = new MarketPreview[](allMarkets.length);
    for (uint256 i = 0; i < allMarkets.length; ++i) {
      IMarket market = allMarkets[i];
      // slither-disable-next-line calls-loop
      bytes memory data = LibCall.staticCallContract(address(auditor), abi.encodeCall(IAuditor.markets, (market)));
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
    }
  }

  function pendingProposals(address account) external view returns (PendingProposal[] memory proposals) {
    IProposalManager proposalManager_ = _proposalManager(account);
    if (address(proposalManager_) == address(0)) return proposals;
    uint256 queueNonce = proposalManager_.queueNonces(account);
    uint256 nonce = proposalManager_.nonces(account);
    uint256 delay = proposalManager_.delay();
    proposals = new PendingProposal[](queueNonce - nonce);
    for (uint256 i = nonce; i < queueNonce; ++i) {
      // slither-disable-next-line calls-loop
      (uint256 amount, IMarket market, uint256 timestamp, ProposalType proposalType, bytes memory data) =
        proposalManager_.proposals(account, i);
      proposals[i - nonce] = PendingProposal({
        nonce: i,
        unlock: timestamp + delay,
        proposal: Proposal({
          amount: amount, market: market, timestamp: timestamp, proposalType: proposalType, data: data
        })
      });
    }
  }

  function proposalManager(address account) external view returns (ProposalManagerPreview memory preview) {
    IProposalManager proposalManager_ = _proposalManager(account);
    if (address(proposalManager_) == address(0)) return preview;
    return ProposalManagerPreview({
      proposalManager: address(proposalManager_),
      delay: proposalManager_.delay(),
      queueNonce: proposalManager_.queueNonces(account),
      nonce: proposalManager_.nonces(account)
    });
  }

  function _proposalManager(address account) internal view returns (IProposalManager proposalManager_) {
    if (account.code.length == 0) return proposalManager_;
    try IAccountLoupe(account).getExecutionFunctionConfig(IExaAccount.propose.selector) returns (
      IAccountLoupe.ExecutionFunctionConfig memory config
    ) {
      if (config.plugin.code.length == 0) return proposalManager_;
      try ExaPlugin(payable(config.plugin)).proposalManager() returns (IProposalManager result) {
        return result;
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

struct ProposalManagerPreview {
  address proposalManager;
  uint256 delay;
  uint256 queueNonce;
  uint256 nonce;
}
