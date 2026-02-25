// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Auditor, IPriceFeed } from "@exactly/protocol/Auditor.sol";
import { Market } from "@exactly/protocol/Market.sol";

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { LibString } from "solady/utils/LibString.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { MockSwapper } from "./MockSwapper.sol";
import { MockVelodromeFactory, MockVelodromePool } from "./MockVelodromeFactory.sol";

contract DeployMocks is BaseScript {
  using FixedPointMathLib for uint256;
  using LibString for address;
  using LibString for string;
  using LibString for bytes;

  MockVelodromeFactory public velodromeFactory;
  MockSwapper public swapper;

  function run() external {
    Auditor auditor = Auditor(protocol("Auditor"));
    MockERC20 usdc = MockERC20(protocol("USDC"));

    vm.startBroadcast(acct("deployer"));

    velodromeFactory = new MockVelodromeFactory();
    swapper = new MockSwapper(velodromeFactory);
    vm.label(address(velodromeFactory), "VelodromeFactory");
    vm.label(address(swapper), "Swapper");

    Market[] memory markets = auditor.allMarkets();
    for (uint256 i = 0; i < markets.length; ++i) {
      MockERC20 asset = MockERC20(address(markets[i].asset()));
      string memory marketSymbol = markets[i].symbol();
      string memory assetSymbol = marketSymbol.slice(3);
      vm.label(address(markets[i]), marketSymbol);
      vm.label(address(asset), assetSymbol);
      if (address(asset) == address(usdc)) continue;
      MockVelodromePool pool = velodromeFactory.createPool(address(asset), address(usdc), false);
      vm.label(address(pool), string.concat(assetSymbol, "/USDC"));

      (,,,, IPriceFeed priceFeed) = auditor.markets(markets[i]);
      asset.mint(address(pool), uint256(1_000_000e18).mulDiv(10 ** asset.decimals(), auditor.assetPrice(priceFeed)));
      usdc.mint(address(pool), 1_000_000e6);
      pool.poke();
    }

    vm.stopBroadcast();

    if (block.chainid == getChain("anvil").chainId) {
      address target = acct("swapper");
      bytes memory code = address(swapper).code;
      vm.etch(target, code);
      try vm.activeFork() {
        vm.rpc("anvil_setCode", string.concat('["', target.toHexString(), '","', code.toHexString(), '"]')); // solhint-disable-line quotes
      } catch { } // solhint-disable-line no-empty-blocks
    }
  }
}
