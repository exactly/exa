// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Auditor, IPriceFeed } from "@exactly/protocol/Auditor.sol";
import { Market } from "@exactly/protocol/Market.sol";

import { WETH } from "solady/tokens/WETH.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibString } from "solady/utils/LibString.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { MockSwapper } from "./MockSwapper.sol";
import { MockVelodromePool } from "./MockVelodromeFactory.sol";

contract DeploySwapper is BaseScript {
  using FixedPointMathLib for uint256;
  using LibString for string;

  MockSwapper public swapper;

  function run() external {
    Auditor auditor = Auditor(protocol("Auditor"));
    MockERC20 usdc = MockERC20(protocol("USDC"));
    Market[] memory markets = auditor.allMarkets();
    uint256[] memory prices = new uint256[](markets.length);

    WETH weth;
    uint256 usdcPrice;
    for (uint256 i = 0; i < markets.length; ++i) {
      (,,,, IPriceFeed priceFeed) = ILegacyAuditor(address(auditor)).markets(markets[i]);
      prices[i] = auditor.assetPrice(priceFeed);
      if (address(markets[i].asset()) == address(usdc)) usdcPrice = prices[i];
      if (markets[i].symbol().slice(3).eq("WETH")) weth = WETH(payable(address(markets[i].asset())));
    }

    vm.startBroadcast(acct("deployer"));

    swapper = new MockSwapper(MockSwapper(payable(acct("swapper"))).VELODROME_FACTORY(), address(usdc), weth);
    vm.label(address(swapper), "Swapper");
    SafeTransferLib.safeTransferETH(address(swapper), 0.1 ether);

    for (uint256 i = 0; i < markets.length; ++i) {
      MockERC20 asset = MockERC20(address(markets[i].asset()));
      uint256 unit = 10 ** asset.decimals();
      asset.mint(address(swapper), uint256(1_000_000e18).mulDiv(unit, prices[i]));
      if (address(asset) == address(usdc)) continue;

      MockVelodromePool pool =
        MockVelodromePool(swapper.VELODROME_FACTORY().getPool(address(asset), address(usdc), false));
      if (address(pool) == address(0)) continue;
      uint256 assetValue = asset.balanceOf(address(pool)).mulDiv(prices[i], unit);
      uint256 usdcValue = usdc.balanceOf(address(pool)).mulDiv(usdcPrice, 1e6);
      if (assetValue < usdcValue) asset.mint(address(pool), (usdcValue - assetValue).mulDiv(unit, prices[i]));
      else if (usdcValue < assetValue) usdc.mint(address(pool), (assetValue - usdcValue).mulDiv(1e6, usdcPrice));
      pool.poke();
    }

    vm.stopBroadcast();
  }
}

interface ILegacyAuditor {
  function markets(Market market) external view returns (uint128, uint8, uint8, bool, IPriceFeed);
}
