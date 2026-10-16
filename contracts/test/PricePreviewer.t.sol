// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { IAuditor, IMarket, IPriceFeed } from "../src/IExaAccount.sol";
import { Feed, Price, PricePreviewer } from "../src/PricePreviewer.sol";
import { MockPriceFeed } from "./mocks/MockPriceFeed.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract PricePreviewerTest is ForkTest {
  PricePreviewer internal previewer;
  MockPriceFeed internal feed;

  function setUp() external {
    previewer = PricePreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(PricePreviewer).runtimeCode);
    vm.makePersistent(address(previewer));

    feed = new MockPriceFeed(8);
    for (uint256 i = 1; i < 11; ++i) {
      feed.push(1, i * 100, int256(i));
    }
    feed.setStrict(1);
    feed.setStrict(2);
    feed.push(3, 950, 95);
    feed.push(3, 1100, 11);
    feed.push(3, 1200, -12);
    feed.push(3, 1300, 13);
    feed.push(3, 1500, 15);
    feed.push(4, 1450, 145);
    feed.push(4, 1600, 16);
    feed.push(4, 1700, 17);
    feed.push(4, 1800, 18);
    feed.push(4, 1900, 19);
    feed.setHidden(1);
  }

  // solhint-disable func-name-mixedcase

  function test_feeds_returnsAssetAndFeedOfEachMarket() external {
    DeployProtocol p = new DeployProtocol();
    p.run();
    IAuditor auditor = IAuditor(address(p.auditor()));
    IMarket[] memory markets = auditor.allMarkets();
    Feed[] memory feeds = previewer.feeds(auditor);
    assertEq(feeds.length, 3);
    assertEq(feeds[0].asset, address(p.exa()));
    assertEq(feeds[1].asset, address(p.usdc()));
    assertEq(feeds[2].asset, address(p.weth()));
    for (uint256 i = 0; i < feeds.length; ++i) {
      assertEq(address(feeds[i].feed), address(auditor.markets(markets[i]).priceFeed));
    }
  }

  function test_prices_returnsLatestReportAtOrBeforeEachSample() external {
    Price[] memory expected = new Price[](3);
    expected[0] = Price(150, 1);
    expected[1] = Price(250, 2);
    expected[2] = Price(350, 3);
    vm.warp(350);
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 100, 3);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 300);
  }

  function test_prices_returnsFeedDecimals() external view {
    (uint8 decimals,,) = previewer.prices(feed, 100, 0);
    assertEq(decimals, 8);
  }

  function test_prices_returnsEmptyPrices_beforeHistory() external {
    Price[] memory expected = new Price[](3);
    expected[2] = Price(120, 1);
    vm.warp(120);
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 60, 3);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 100);
  }

  function test_prices_repeatsReport_untilNextReport() external {
    Price[] memory expected = new Price[](3);
    expected[0] = Price(100, 1);
    expected[1] = Price(150, 1);
    expected[2] = Price(200, 2);
    vm.warp(200);
    (,, Price[] memory prices) = previewer.prices(feed, 50, 3);
    assertEq(abi.encode(prices), abi.encode(expected));
  }

  function test_prices_prefersNewerPhaseFromItsFirstReport() external {
    Price[] memory expected = new Price[](2);
    expected[0] = Price(940, 9);
    expected[1] = Price(1000, 95);
    vm.warp(1000);
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 60, 2);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 950);
    expected[0] = Price(1440, 13);
    expected[1] = Price(1500, 145);
    vm.warp(1500);
    (, updated, prices) = previewer.prices(feed, 60, 2);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 1450);
  }

  function test_prices_skipsEmptyPhases() external {
    MockPriceFeed sparse = new MockPriceFeed(8);
    sparse.push(1, 100, 1);
    sparse.push(3, 300, 3);
    sparse.setStrict(2);
    Price[] memory expected = new Price[](3);
    expected[0] = Price(100, 1);
    expected[1] = Price(200, 1);
    expected[2] = Price(300, 3);
    vm.warp(300);
    (,, Price[] memory prices) = previewer.prices(sparse, 100, 3);
    assertEq(abi.encode(prices), abi.encode(expected));
  }

  function test_prices_ignoresRoundsAfterLatest() external {
    Price[] memory expected = new Price[](1);
    expected[0] = Price(2000, 18);
    vm.warp(2000);
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 0, 1);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 1800);
  }

  function test_prices_fallsBackToPreviousPhase_whenLatestPhaseIsHidden() external {
    feed.setHidden(5);
    Price[] memory expected = new Price[](1);
    expected[0] = Price(2000, 15);
    vm.warp(2000);
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 0, 1);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, 1500);
  }

  function test_prices_preservesNegativeAnswers() external {
    Price[] memory expected = new Price[](1);
    expected[0] = Price(1250, -12);
    vm.warp(1250);
    (,, Price[] memory prices) = previewer.prices(feed, 0, 1);
    assertEq(abi.encode(prices), abi.encode(expected));
  }

  function test_prices_returnsEmpty_whenCountIsZero() external view {
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, 100, 0);
    assertEq(prices.length, 0);
    assertEq(updated, 0);
  }

  function test_prices_matchesReference(uint256 start, uint256 interval, uint256 count) external {
    start = bound(start, 0, 2100);
    interval = bound(interval, 0, 300);
    count = bound(count, 0, 40);
    if (count != 0) vm.warp(start + interval * (count - 1));
    (, uint256 updated, Price[] memory prices) = previewer.prices(feed, interval, count);
    (uint256 expectedUpdated, Price[] memory expected) = _reference(start, interval, count);
    assertEq(abi.encode(prices), abi.encode(expected));
    assertEq(updated, expectedUpdated);
  }

  function test_prices_samplesEthUsdAcrossPhases_onBase() external {
    vm.createSelectFork("base", 52_590_000);
    IPriceFeed ethUSD = IPriceFeed(protocol("PriceFeedWETH"));
    uint256 interval = (block.timestamp - 1_691_045_273) / 159;
    vm.warp(1_691_045_273 + interval * 159);
    uint256 gas = gasleft();
    (uint8 decimals, uint256 updated, Price[] memory prices) = previewer.prices(ethUSD, interval, 160);
    gas -= gasleft();
    assertEq(decimals, 8);
    assertEq(prices.length, 160);
    assertEq(prices[0].timestamp, 1_691_045_273);
    assertEq(prices[0].answer, 183_602_069_149);
    for (uint256 i = 1; i < prices.length; ++i) {
      assertEq(prices[i].timestamp, prices[0].timestamp + interval * i);
      assertGt(prices[i].answer, 0);
    }
    assertLe(updated, block.timestamp);
    assertGe(updated, block.timestamp - 1 hours);
    assertLt(gas, 50_000_000);
  }

  function test_prices_samplesEthUsdOverThirtyDays_onBase() external {
    vm.createSelectFork("base", 52_590_000);
    IPriceFeed ethUSD = IPriceFeed(protocol("PriceFeedWETH"));
    uint256 gas = gasleft();
    (, uint256 updated, Price[] memory prices) = previewer.prices(ethUSD, uint256(30 days) / 159, 160);
    gas -= gasleft();
    assertEq(prices.length, 160);
    for (uint256 i = 0; i < prices.length; ++i) {
      assertGt(prices[i].answer, 0);
    }
    assertGe(prices[0].timestamp, block.timestamp - 30 days);
    assertEq(prices[159].timestamp, block.timestamp);
    assertGe(updated, block.timestamp - 1 hours);
    assertLt(gas, 50_000_000);
  }

  function test_prices_switchesPhasesAtFirstReport_onBase() external {
    vm.createSelectFork("base", 52_590_000);
    IPriceFeed ethUSD = IPriceFeed(protocol("PriceFeedWETH"));

    vm.warp(1_773_930_645);
    (, uint256 updated, Price[] memory prices) = previewer.prices(ethUSD, 1, 2);
    assertEq(prices.length, 2);
    assertGt(prices[0].answer, 0);
    assertEq(prices[1].answer, 210_851_746_641);
    assertEq(updated, 1_773_930_645);

    vm.warp(1_787_757_083);
    (, updated, prices) = previewer.prices(ethUSD, 1, 2);
    assertEq(prices.length, 2);
    assertGt(prices[0].answer, 0);
    assertEq(prices[1].answer, 244_242_930_000);
    assertEq(updated, 1_787_757_083);
  }

  // solhint-enable func-name-mixedcase

  function _reference(uint256 start, uint256 interval, uint256 count)
    internal
    view
    returns (uint256 updated, Price[] memory expected)
  {
    expected = new Price[](count);
    for (uint256 i = 0; i < count; ++i) {
      uint256 timestamp = start + interval * i;
      for (uint256 phase = feed.phaseId(); phase != 0; --phase) {
        Price[] memory reports = feed.visible(phase);
        if (reports.length == 0 || reports[0].timestamp > timestamp) continue;
        uint256 round = 1;
        while (round < reports.length && reports[round].timestamp <= timestamp) ++round; // solhint-disable-line gas-strict-inequalities
        updated = reports[round - 1].timestamp;
        expected[i] = Price(timestamp, reports[round - 1].answer);
        break;
      }
    }
  }
}
