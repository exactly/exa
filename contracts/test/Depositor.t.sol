// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { FixedLib, Market } from "@exactly/protocol/Market.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { Depositor } from "../src/Depositor.sol";
import { IAuditor, IMarket, NotMarket, Unauthorized } from "../src/IExaAccount.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract DepositorTest is ForkTest {
  Depositor internal depositor;
  Market internal exaUSDC;
  MockERC20 internal usdc;
  address internal bob = address(0xb0b);

  function setUp() external {
    DeployProtocol p = new DeployProtocol();
    p.run();
    exaUSDC = p.exaUSDC();
    usdc = p.usdc();
    depositor = new Depositor(IAuditor(address(p.auditor())));

    usdc.mint(address(this), 1000e6);
    usdc.approve(address(depositor), type(uint256).max);
  }

  // solhint-disable func-name-mixedcase
  function test_depositAtMaturity_depositsForReceiver() external {
    uint256 positionAssets =
      depositor.depositAtMaturity(IMarket(address(exaUSDC)), FixedLib.INTERVAL, 100e6, 100e6, bob);

    (uint256 principal, uint256 fee) = exaUSDC.fixedDepositPositions(FixedLib.INTERVAL, bob);
    assertEq(principal + fee, positionAssets);
    assertEq(principal, 100e6);
    assertEq(usdc.balanceOf(address(this)), 900e6);
    assertEq(usdc.balanceOf(address(depositor)), 0);
    assertEq(usdc.allowance(address(depositor), address(exaUSDC)), 0);
  }

  function test_depositAtMaturity_reverts_whenMarketIsNotListed() external {
    vm.expectRevert(NotMarket.selector);
    depositor.depositAtMaturity(IMarket(address(usdc)), FixedLib.INTERVAL, 100e6, 100e6, bob);
  }

  function test_depositAtMaturity_reverts_whenReceiverIsDepositor() external {
    vm.expectRevert(Unauthorized.selector);
    depositor.depositAtMaturity(IMarket(address(exaUSDC)), FixedLib.INTERVAL, 100e6, 100e6, address(depositor));
  }
  // solhint-enable func-name-mixedcase
}
