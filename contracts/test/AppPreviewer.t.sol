// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { AppPreviewer, MarketPreview } from "../src/AppPreviewer.sol";
import { IAuditor, IMarket } from "../src/IExaAccount.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract AppPreviewerTest is ForkTest {
  AppPreviewer internal previewer;
  DeployProtocol internal p;
  IAuditor internal auditor;

  function setUp() external {
    previewer = AppPreviewer(makeAddr("previewer"));
    vm.etch(address(previewer), type(AppPreviewer).runtimeCode);

    set("deployer", address(this));
    p = new DeployProtocol();
    p.run();
    auditor = IAuditor(address(p.auditor()));
  }

  // solhint-disable func-name-mixedcase

  function test_markets_returnsMarkets() external view {
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertEq(markets.length, 3);
    assertEq(markets[0].market, address(p.exaEXA()));
    assertEq(markets[1].market, address(p.exaUSDC()));
    assertEq(markets[2].market, address(p.exaWETH()));
    assertEq(markets[0].asset, address(p.exa()));
    assertEq(markets[1].asset, address(p.usdc()));
    assertEq(markets[2].asset, address(p.weth()));
    assertEq(markets[0].decimals, 18);
    assertEq(markets[1].decimals, 6);
    assertEq(markets[2].decimals, 18);
    assertEq(markets[0].usdPrice, 5e18);
    assertEq(markets[1].usdPrice, 1e18);
    assertEq(markets[2].usdPrice, 2500e18);
    assertEq(markets[0].symbol, "EXA");
    assertEq(markets[1].symbol, "USDC");
    assertEq(markets[2].symbol, "WETH");
    for (uint256 i = 0; i < markets.length; ++i) {
      assertFalse(markets[i].nonCollateral);
      assertFalse(markets[i].isFrozen);
    }
  }

  function test_markets_returnsFrozen() external {
    p.exaUSDC().setFrozen(true);
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].isFrozen);
    assertTrue(markets[1].isFrozen);
    assertFalse(markets[2].isFrozen);
  }

  function test_markets_returnsNonCollateral() external {
    IMarket market = IMarket(address(p.exaUSDC()));
    vm.mockCall(address(auditor), abi.encodeCall(IAuditor.markets, (market)), abi.encode(auditor.markets(market), true));
    MarketPreview[] memory markets = previewer.markets(auditor);
    assertFalse(markets[0].nonCollateral);
    assertTrue(markets[1].nonCollateral);
    assertFalse(markets[2].nonCollateral);
    assertEq(markets[1].usdPrice, 1e18);
  }

  // solhint-enable func-name-mixedcase
}
