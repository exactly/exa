// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IAuditor, IMarket, IPriceFeed } from "./IExaAccount.sol";

contract PricePreviewer {
  function feeds(IAuditor auditor) external view returns (Feed[] memory feeds_) {
    IMarket[] memory markets = auditor.allMarkets();
    feeds_ = new Feed[](markets.length);
    for (uint256 i = 0; i < markets.length; ++i) {
      // slither-disable-next-line calls-loop
      feeds_[i] = Feed({ asset: markets[i].asset(), feed: auditor.markets(markets[i]).priceFeed });
    }
  }

  function prices(IPriceFeed feed, uint256 interval, uint256 count)
    external
    view
    returns (uint8 decimals, uint256 updated, Price[] memory prices_)
  {
    decimals = feed.decimals();
    uint256 phases = feed.phaseId();
    (uint80 latest,,,,) = feed.latestRoundData();
    uint256[] memory firsts = new uint256[](phases + 1);
    for (uint256 phase = phases; phase != 0; --phase) {
      firsts[phase] = _read(feed, phase << 64 | 1).timestamp;
    }
    if (latest == phases << 64) firsts[phases] = 0;
    prices_ = new Price[](count);
    uint256 id = 0;
    uint256 last = 0;
    for (uint256 i = 0; i < count; ++i) {
      uint256 timestamp = block.timestamp - interval * (count - 1 - i);
      uint256 phase = phases;
      while (phase != 0 && (firsts[phase] == 0 || firsts[phase] > timestamp)) --phase;
      if (phase == 0) continue;
      if (phase != id >> 64) {
        id = phase << 64 | 1;
        last = phase == phases ? latest : _search(feed, id, id | type(uint64).max, type(uint256).max);
      }
      id = _search(feed, id, last, timestamp);
      Price memory price = _read(feed, id);
      updated = price.timestamp;
      prices_[i] = Price({ timestamp: timestamp, answer: price.answer });
    }
  }

  function _search(IPriceFeed feed, uint256 low, uint256 high, uint256 timestamp) internal view returns (uint256) {
    while (low < high) {
      uint256 mid = (low + high + 1) / 2;
      uint256 updatedAt = _read(feed, mid).timestamp;
      if (updatedAt == 0 || updatedAt > timestamp) high = mid - 1;
      else low = mid;
    }
    return low;
  }

  function _read(IPriceFeed feed, uint256 id) internal view returns (Price memory) {
    // slither-disable-next-line calls-loop
    try feed.getRoundData(uint80(id)) returns (uint80, int256 answer, uint256, uint256 updatedAt, uint80) { // forge-lint: disable-line(unsafe-typecast)
      return Price({ timestamp: updatedAt, answer: answer });
    } catch {
      return Price({ timestamp: 0, answer: 0 });
    }
  }
}

struct Feed {
  address asset;
  IPriceFeed feed;
}

struct Price {
  uint256 timestamp;
  int256 answer;
}
