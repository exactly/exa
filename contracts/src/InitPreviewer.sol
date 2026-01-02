// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IMarket } from "./IExaAccount.sol";

contract InitPreviewer {
  /// @dev Returns markets that need to be initialized for the given account.
  /// if the account doesn't need to be initialized, the market will be Market(address(0))
  function needsInit(IAuditor auditor, address account) external view returns (IMarket[] memory markets) {
    IMarketPreviewer[] memory allMarkets = auditor.allMarkets();
    markets = new IMarket[](allMarkets.length);
    for (uint256 i = 0; i < allMarkets.length; ++i) {
      IMarketPreviewer market = allMarkets[i];
      if (market.isInitialized(account)) continue;
      (uint256 fixedDeposits, uint256 fixedBorrows,) = market.accounts(account);
      if (fixedDeposits == 0 && fixedBorrows == 0) continue;
      markets[i] = market;
    }
  }
}

interface IAuditor {
  function allMarkets() external view returns (IMarketPreviewer[] memory);
}

interface IMarketPreviewer is IMarket {
  function accounts(address account) external view returns (uint256 fixedDeposits, uint256 fixedBorrows, uint256);
  function isInitialized(address account) external view returns (bool);
}
