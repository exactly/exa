// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Auditor, IPriceFeed, Market } from "@exactly/protocol/Auditor.sol";
import { ERC20, Market } from "@exactly/protocol/Market.sol";
import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibString } from "solady/utils/LibString.sol";
import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { BaseScript } from "../../script/Base.s.sol";

contract DeployPools is BaseScript {
  using FixedPointMathLib for uint256;
  using LibString for string;

  function run() external {
    IUniswap3PositionManager positionManager = IUniswap3PositionManager(acct("Uniswap3PositionManager"));
    address deployer = acct("deployer");
    Auditor auditor = Auditor(protocol("Auditor"));
    ERC20 usdc = ERC20(protocol("USDC"));

    vm.startBroadcast(deployer);

    usdc.approve(address(positionManager), type(uint256).max);
    Market[] memory markets = auditor.allMarkets();
    for (uint256 i = 0; i < markets.length; ++i) {
      ERC20 asset = markets[i].asset();
      string memory marketSymbol = markets[i].symbol();
      string memory assetSymbol = marketSymbol.slice(3);
      vm.label(address(markets[i]), marketSymbol);
      vm.label(address(asset), assetSymbol);
      if (asset == usdc) continue;

      uint256 assetPrice;
      {
        (,,,, IPriceFeed priceFeed) = auditor.markets(markets[i]);
        assetPrice = auditor.assetPrice(priceFeed);
      }
      uint256 baseUnit = 10 ** asset.decimals();
      MockERC20(address(usdc)).mint(deployer, 1_000_000e6);
      MockERC20(address(asset)).mint(deployer, uint256(1_000_000e18).mulDiv(baseUnit, assetPrice));

      uint160 sqrtPriceX96 = uint160(
        FixedPointMathLib.sqrt(
          (asset < usdc ? assetPrice * 1e6 : 1e18 * baseUnit).mulDiv(
            1 << 128, asset < usdc ? 1e18 * baseUnit : assetPrice * 1e6
          )
        ) << 32
      );
      vm.label(
        positionManager.createAndInitializePoolIfNecessary(
          asset < usdc ? asset : usdc, asset < usdc ? usdc : asset, 500, sqrtPriceX96
        ),
        string.concat(assetSymbol, "/USDC")
      );
      asset.approve(address(positionManager), type(uint256).max);
      positionManager.mint(
        MintParams({
          token0: asset < usdc ? asset : usdc,
          token1: asset < usdc ? usdc : asset,
          fee: 500,
          tickLower: -887_220, // full range
          tickUpper: 887_220, // full range
          amount0Desired: asset < usdc ? uint256(1_000_000e18).mulDiv(baseUnit, assetPrice) : 1_000_000e6,
          amount1Desired: asset < usdc ? 1_000_000e6 : uint256(1_000_000e18).mulDiv(baseUnit, assetPrice),
          amount0Min: 0,
          amount1Min: 0,
          recipient: deployer,
          deadline: block.timestamp + 1 days
        })
      );
    }

    vm.stopBroadcast();
  }
}

interface IUniswap3PositionManager {
  function createAndInitializePoolIfNecessary(ERC20 token0, ERC20 token1, uint24 fee, uint160 sqrtPriceX96)
    external
    payable
    returns (address pool);

  function mint(MintParams calldata params)
    external
    payable
    returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);
}

struct MintParams {
  ERC20 token0;
  ERC20 token1;
  uint24 fee;
  int24 tickLower;
  int24 tickUpper;
  uint256 amount0Desired;
  uint256 amount1Desired;
  uint256 amount0Min;
  uint256 amount1Min;
  address recipient;
  uint256 deadline;
}
