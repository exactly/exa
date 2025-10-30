// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Auditor } from "@exactly/protocol/Auditor.sol";
import { Market } from "@exactly/protocol/Market.sol";
import { MockPriceFeed } from "@exactly/protocol/mocks/MockPriceFeed.sol";
import { Ownable } from "solady/auth/Ownable.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

import { DeployLiquidator } from "../script/Liquidator.s.sol";
import { Liquidator } from "../src/Liquidator.sol";
import { ForkTest } from "./Fork.t.sol";

contract LiquidatorTest is ForkTest {
  using SafeTransferLib for address;

  address internal constant ALICE = address(0x420);
  address internal constant BOB = address(0x069);

  Liquidator internal liquidator;
  Market internal exaWETH;
  Market internal exaUSDC;
  Market internal exaOP;
  Market internal exawstETH;
  Auditor internal auditor;
  address internal timelock;
  address internal op;
  address internal usdc;
  address internal weth;
  address internal wstETH;

  function setUp() public {
    vm.createSelectFork("optimism", 109_683_846);

    auditor = Auditor(protocol("Auditor"));
    exaWETH = Market(protocol("MarketWETH"));
    exaUSDC = Market(protocol("MarketUSDC.e"));
    exaOP = Market(protocol("MarketOP"));
    exawstETH = Market(protocol("MarketwstETH")); // cspell:ignore exawstETH MarketwstETH
    timelock = protocol("TimelockController");
    op = protocol("OP");
    usdc = protocol("USDC.e");
    weth = protocol("WETH");
    wstETH = protocol("wstETH");

    set("liquidatorAdmin", address(this));
    DeployLiquidator d = new DeployLiquidator();
    d.run();
    liquidator = d.liquidator();

    vm.label(ALICE, "alice");
  }

  // solhint-disable func-name-mixedcase

  function test_liquidateUniswap_singleMarketLiquidation() external {
    deal(weth, BOB, 61.34 ether);
    vm.startPrank(BOB);
    weth.safeApprove(address(exaWETH), type(uint256).max);
    exaWETH.deposit(61.34 ether, BOB);
    vm.stopPrank();

    deal(usdc, ALICE, 100_000e6);
    vm.startPrank(ALICE);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, ALICE);
    auditor.enterMarket(exaUSDC);
    exaWETH.borrow(40 ether, ALICE, ALICE);
    exaUSDC.borrow(2000e6, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaWETH, new MockPriceFeed(8, 7000e8));
    vm.stopPrank();

    liquidator.liquidateUniswap(address(exaUSDC), address(exaUSDC), ALICE, 2000e6, weth, 500, 0);
    assertGt(usdc.balanceOf(address(liquidator)), 0);
  }

  function test_liquidateUniswap_multiMarketLiquidation() external {
    deal(weth, BOB, 61.34 ether);
    vm.startPrank(BOB);
    weth.safeApprove(address(exaWETH), type(uint256).max);
    exaWETH.deposit(61.34 ether, BOB);
    vm.stopPrank();

    deal(usdc, ALICE, 100_000e6);
    vm.startPrank(ALICE);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, ALICE);
    auditor.enterMarket(exaUSDC);
    exaWETH.borrow(42.9 ether, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaWETH, new MockPriceFeed(8, 5000e8));
    vm.stopPrank();

    uint256 balanceBefore = usdc.balanceOf(address(liquidator));
    liquidator.liquidateUniswap(address(exaWETH), address(exaUSDC), ALICE, 40 ether, address(0), 500, 0);
    assertGt(usdc.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_liquidateUniswap_doubleSwapLiquidation() external {
    deal(usdc, BOB, 100_000e6);
    vm.startPrank(BOB);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, BOB);
    vm.stopPrank();

    deal(address(wstETH), ALICE, 100 ether);
    vm.startPrank(ALICE);
    wstETH.safeApprove(address(exawstETH), type(uint256).max);
    exawstETH.deposit(100 ether, ALICE);
    auditor.enterMarket(exawstETH);
    exaUSDC.borrow(60_000e6, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaUSDC, new MockPriceFeed(8, 5e8));
    vm.stopPrank();

    uint256 balanceBefore = wstETH.balanceOf(address(liquidator));
    liquidator.liquidateUniswap(address(exaUSDC), address(exawstETH), ALICE, 2000e6, weth, 500, 500);
    assertGt(wstETH.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_liquidateUniswap_reverseDoubleSwapLiquidation() external {
    deal(address(wstETH), BOB, 100 ether);
    vm.startPrank(BOB);
    wstETH.safeApprove(address(exawstETH), type(uint256).max);
    exawstETH.deposit(100 ether, BOB);
    vm.stopPrank();

    deal(usdc, ALICE, 100_000e6);
    vm.startPrank(ALICE);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, ALICE);
    auditor.enterMarket(exaUSDC);
    exawstETH.borrow(30 ether, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exawstETH, new MockPriceFeed(8, 3200e8));
    vm.stopPrank();

    uint256 balanceUSDCBefore = usdc.balanceOf(address(liquidator));
    liquidator.liquidateUniswap(address(exawstETH), address(exaUSDC), ALICE, 20 ether, weth, 100, 500);
    assertGt(usdc.balanceOf(address(liquidator)), balanceUSDCBefore);
  }

  function test_liquidateUniswap_anotherDoubleSwapLiquidation() external {
    deal(address(wstETH), BOB, 100 ether);
    vm.startPrank(BOB);
    wstETH.safeApprove(address(exawstETH), type(uint256).max);
    exawstETH.deposit(100 ether, BOB);
    vm.stopPrank();

    deal(address(op), ALICE, 25_000 ether);
    vm.startPrank(ALICE);
    op.safeApprove(address(exaOP), type(uint256).max);
    exaOP.deposit(25_000 ether, ALICE);
    auditor.enterMarket(exaOP);
    exawstETH.borrow(6 ether, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaOP, new MockPriceFeed(8, 0.1e8));
    vm.stopPrank();

    uint256 balanceOPBefore = op.balanceOf(address(liquidator));
    liquidator.liquidateUniswap(address(exawstETH), address(exaOP), ALICE, 2 ether, weth, 100, 3000);
    assertGt(op.balanceOf(address(liquidator)), balanceOPBefore);
  }

  function test_liquidateVelodrome_multiMarketLiquidation() external {
    deal(weth, BOB, 50 ether);
    vm.startPrank(BOB);
    weth.safeApprove(address(exaWETH), type(uint256).max);
    exaWETH.deposit(50 ether, BOB);
    vm.stopPrank();

    deal(usdc, ALICE, 100_000e6);
    vm.startPrank(ALICE);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, ALICE);
    auditor.enterMarket(exaUSDC);
    exaWETH.borrow(20 ether, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaWETH, new MockPriceFeed(8, 10 ether));
    vm.stopPrank();

    uint256 balanceBefore = usdc.balanceOf(address(liquidator));
    liquidator.liquidateVelodrome(address(exaWETH), address(exaUSDC), ALICE, 10 ether, address(0), false, false);
    assertGt(usdc.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_liquidateVelodrome_reverseMultiMarketLiquidation() external {
    deal(usdc, BOB, 100_000e6);
    vm.startPrank(BOB);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, BOB);
    vm.stopPrank();

    deal(weth, ALICE, 50 ether);
    vm.startPrank(ALICE);
    weth.safeApprove(address(exaWETH), type(uint256).max);
    exaWETH.deposit(50 ether, ALICE);
    auditor.enterMarket(exaWETH);
    exaUSDC.borrow(60_000e6, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaUSDC, new MockPriceFeed(8, 3e8));
    vm.stopPrank();

    uint256 balanceBefore = weth.balanceOf(address(liquidator));
    liquidator.liquidateVelodrome(address(exaUSDC), address(exaWETH), ALICE, 30_000e6, address(0), false, false);
    assertGt(weth.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_liquidateVelodrome_doubleSwapLiquidation() external {
    deal(usdc, BOB, 100_000e6);
    vm.startPrank(BOB);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, BOB);
    vm.stopPrank();

    deal(address(wstETH), ALICE, 100 ether);
    vm.startPrank(ALICE);
    wstETH.safeApprove(address(exawstETH), type(uint256).max);
    exawstETH.deposit(100 ether, ALICE);
    auditor.enterMarket(exawstETH);
    exaUSDC.borrow(60_000e6, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaUSDC, new MockPriceFeed(8, 5e8));
    vm.stopPrank();

    uint256 balanceBefore = wstETH.balanceOf(address(liquidator));
    liquidator.liquidateVelodrome(address(exaUSDC), address(exawstETH), ALICE, 30_000e6, weth, false, false);
    assertGt(wstETH.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_liquidateVelodrome_reverseDoubleSwapLiquidation() external {
    deal(address(wstETH), BOB, 50 ether);
    vm.startPrank(BOB);
    wstETH.safeApprove(address(exawstETH), type(uint256).max);
    exawstETH.deposit(50 ether, BOB);
    vm.stopPrank();

    deal(usdc, ALICE, 100_000e6);
    vm.startPrank(ALICE);
    usdc.safeApprove(address(exaUSDC), type(uint256).max);
    exaUSDC.deposit(100_000e6, ALICE);
    auditor.enterMarket(exaUSDC);
    exawstETH.borrow(30 ether, ALICE, ALICE);
    vm.stopPrank();

    vm.startPrank(timelock);
    auditor.setPriceFeed(exaUSDC, new MockPriceFeed(8, 0.2e8));
    vm.stopPrank();

    uint256 balanceBefore = usdc.balanceOf(address(liquidator));
    liquidator.liquidateVelodrome(address(exawstETH), address(exaUSDC), ALICE, 20 ether, weth, false, false);
    assertGt(usdc.balanceOf(address(liquidator)), balanceBefore);
  }

  function test_swap() external {
    deal(usdc, address(liquidator), 666_666e6);
    assertEq(weth.balanceOf(address(liquidator)), 0);
    assertEq(usdc.balanceOf(address(liquidator)), 666_666e6);

    liquidator.swap(usdc, 666_666e6, weth, 0, 500);

    assertGt(weth.balanceOf(address(liquidator)), 0);
    assertEq(usdc.balanceOf(address(liquidator)), 0);
  }

  function test_transfer() external {
    deal(usdc, address(liquidator), 666_666e6);
    assertEq(usdc.balanceOf(address(this)), 0);
    assertEq(usdc.balanceOf(address(liquidator)), 666_666e6);

    liquidator.transfer(usdc, address(this), 666_666e6);

    assertEq(usdc.balanceOf(address(this)), 666_666e6);
    assertEq(usdc.balanceOf(address(liquidator)), 0);
  }

  function test_roles() external {
    vm.prank(ALICE);
    vm.expectRevert(Ownable.Unauthorized.selector);
    liquidator.grantRoles(ALICE, 1);

    vm.prank(ALICE);
    vm.expectRevert(Ownable.Unauthorized.selector);
    liquidator.liquidateUniswap(address(0), address(0), address(0), 0, address(0), 0, 0);

    liquidator.grantRoles(ALICE, 1);

    vm.prank(ALICE);
    vm.expectRevert(Ownable.Unauthorized.selector);
    liquidator.grantRoles(ALICE, 1);

    vm.prank(ALICE);
    vm.expectRevert(Ownable.Unauthorized.selector);
    liquidator.transfer(address(0), address(0), 0);

    vm.prank(ALICE);
    vm.expectRevert();
    liquidator.liquidateUniswap(address(0), address(0), address(0), 0, address(0), 0, 0);
  }

  // solhint-enable func-name-mixedcase
}
