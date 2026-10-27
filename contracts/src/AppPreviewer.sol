// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAccountLoupe } from "modular-account-libs/interfaces/IAccountLoupe.sol";
import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibCall } from "solady/utils/LibCall.sol";
import { LibString } from "solady/utils/LibString.sol";

import { ExaPlugin } from "./ExaPlugin.sol";
import { IAuditor, IExaAccount, IMarket, IProposalManager, MarketData } from "./IExaAccount.sol";

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

  function proposalManager(address account) external view returns (ProposalManagerPreview memory preview) {
    if (account.code.length == 0) return preview;
    try IAccountLoupe(account).getExecutionFunctionConfig(IExaAccount.propose.selector) returns (
      IAccountLoupe.ExecutionFunctionConfig memory config
    ) {
      if (config.plugin.code.length == 0) return preview;
      try ExaPlugin(payable(config.plugin)).proposalManager() returns (IProposalManager manager) {
        return ProposalManagerPreview({
          proposalManager: address(manager),
          delay: manager.delay(),
          queueNonce: manager.queueNonces(account),
          nonce: manager.nonces(account)
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

struct ProposalManagerPreview {
  address proposalManager;
  uint256 delay;
  uint256 queueNonce;
  uint256 nonce;
}
