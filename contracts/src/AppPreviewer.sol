// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { LibBytes } from "solady/utils/LibBytes.sol";
import { LibCall } from "solady/utils/LibCall.sol";
import { LibString } from "solady/utils/LibString.sol";

import { IAuditor, IMarket, MarketData } from "./IExaAccount.sol";

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
