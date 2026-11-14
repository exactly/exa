// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Market } from "@exactly/protocol/Market.sol";
import { MockWETH } from "@exactly/protocol/mocks/MockWETH.sol";

import { MockERC20 } from "solmate/src/test/utils/mocks/MockERC20.sol";

import { ForkTest } from "./Fork.t.sol";
import {
  AlreadyCompleted,
  BridgeData,
  BridgeMessage,
  InvalidValue,
  LiFiGenericSwapCompleted,
  LiFiTransferCompleted,
  LiFiTransferStarted,
  MockSwapper,
  NoRoute,
  NotSelf,
  SwapData,
  UnsupportedSwap
} from "./mocks/MockSwapper.sol";
import { InsufficientInputAmount, InsufficientOutputAmount } from "./mocks/MockVelodromeFactory.sol";
import { DeployMocks } from "./mocks/Mocks.s.sol";
import { DeployProtocol } from "./mocks/Protocol.s.sol";

contract MockSwapperTest is ForkTest {
  MockSwapper internal mockSwapper;
  MockERC20 internal exa;
  MockERC20 internal usdc;
  MockWETH internal weth;
  Market internal exaUSDC;
  address internal receiver;

  function setUp() external {
    DeployProtocol p = new DeployProtocol();
    p.run();
    exa = p.exa();
    usdc = p.usdc();
    weth = p.weth();
    exaUSDC = p.exaUSDC();

    DeployMocks m = new DeployMocks();
    set("Auditor", address(p.auditor()));
    set("USDC", address(usdc));
    m.run();
    unset("Auditor");
    unset("USDC");
    mockSwapper = m.swapper();

    exa.mint(address(this), 10_000e18);
    usdc.mint(address(this), 10_000e6);
    usdc.mint(address(mockSwapper), 1_000_000e6);
    vm.deal(address(this), 100 ether);
    receiver = makeAddr("receiver");
  }

  // solhint-disable func-name-mixedcase

  function test_swapExactAmountOut_swaps() external {
    uint256 balanceOut = usdc.balanceOf(address(this));
    uint256 balanceIn = exa.balanceOf(address(this));
    uint256 amountOut = 100e6;
    exa.approve(address(mockSwapper), type(uint256).max);
    uint256 expectedIn = mockSwapper.getAmountIn(address(exa), amountOut, address(usdc));
    uint256 amountIn =
      mockSwapper.swapExactAmountOut(address(exa), type(uint256).max, address(usdc), amountOut, address(this));
    assertEq(expectedIn, amountIn);
    assertEq(usdc.balanceOf(address(this)), balanceOut + amountOut);
    assertEq(exa.balanceOf(address(this)), balanceIn - amountIn);
  }

  function test_swapExactAmountIn_swaps() external {
    uint256 balanceOut = usdc.balanceOf(address(this));
    uint256 balanceIn = exa.balanceOf(address(this));
    uint256 amountIn = 100e18;
    exa.approve(address(mockSwapper), type(uint256).max);
    uint256 expectedOut = mockSwapper.getAmountOut(address(exa), amountIn, address(usdc));
    uint256 amountOut = mockSwapper.swapExactAmountIn(address(exa), amountIn, address(usdc), 0, address(this));
    assertEq(amountOut, expectedOut);
    assertEq(usdc.balanceOf(address(this)), balanceOut + amountOut);
    assertEq(exa.balanceOf(address(this)), balanceIn - amountIn);
  }

  function test_swapExactAmountIn_routesThroughHub(uint256 amountIn) external {
    amountIn = bound(amountIn, 1e18, 1000e18);
    uint256 balance = exa.balanceOf(address(this));
    uint256 hubBalance = usdc.balanceOf(address(mockSwapper));
    exa.approve(address(mockSwapper), amountIn);
    uint256 expectedOut = mockSwapper.getAmountOut(address(exa), amountIn, address(weth));
    assertGt(expectedOut, 0);

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiGenericSwapCompleted(
      bytes32(0), "exa_app", "exa_app", receiver, address(exa), address(weth), amountIn, expectedOut
    );
    uint256 amountOut = mockSwapper.swapExactAmountIn(address(exa), amountIn, address(weth), expectedOut, receiver);

    assertEq(amountOut, expectedOut);
    assertEq(weth.balanceOf(receiver), amountOut);
    assertEq(exa.balanceOf(address(this)), balance - amountIn);
    assertEq(usdc.balanceOf(address(mockSwapper)), hubBalance);
  }

  function test_swapExactAmountOut_routesThroughHub(uint256 amountOut) external {
    amountOut = bound(amountOut, 0.001e18, 1e18);
    uint256 balance = exa.balanceOf(address(this));
    exa.approve(address(mockSwapper), type(uint256).max);
    uint256 expectedIn = mockSwapper.getAmountIn(address(exa), amountOut, address(weth));

    uint256 amountIn =
      mockSwapper.swapExactAmountOut(address(exa), type(uint256).max, address(weth), amountOut, receiver);

    assertEq(amountIn, expectedIn);
    assertEq(weth.balanceOf(receiver), amountOut);
    assertEq(exa.balanceOf(address(this)), balance - amountIn);
  }

  function test_swapExactAmountOut_reverts_whenInputExceedsMax() external {
    exa.approve(address(mockSwapper), type(uint256).max);
    uint256 expectedIn = mockSwapper.getAmountIn(address(exa), 1e18, address(weth));
    vm.expectRevert(InsufficientInputAmount.selector);
    mockSwapper.swapExactAmountOut(address(exa), expectedIn - 1, address(weth), 1e18, receiver);
  }

  function test_swapExactAmountIn_reverts_whenOutputBelowMin() external {
    exa.approve(address(mockSwapper), type(uint256).max);
    uint256 expectedOut = mockSwapper.getAmountOut(address(exa), 100e18, address(weth));
    vm.expectRevert(InsufficientOutputAmount.selector);
    mockSwapper.swapExactAmountIn(address(exa), 100e18, address(weth), expectedOut + 1, receiver);
  }

  function test_getAmountOut_reverts_whenNoRoute() external {
    MockERC20 orphan = new MockERC20("Orphan", "ORPHAN", 18);
    vm.expectRevert(NoRoute.selector);
    mockSwapper.getAmountOut(address(orphan), 1e18, address(weth));
  }

  function test_swapExactAmountIn_swapsNative(uint256 amountIn) external {
    amountIn = bound(amountIn, 0.001 ether, 10 ether);
    uint256 balance = address(this).balance;
    uint256 expectedOut = mockSwapper.getAmountOut(address(0), amountIn, address(usdc));
    assertEq(expectedOut, mockSwapper.getAmountOut(address(weth), amountIn, address(usdc)));

    uint256 amountOut =
      mockSwapper.swapExactAmountIn{ value: amountIn }(address(0), amountIn, address(usdc), expectedOut, receiver);

    assertEq(amountOut, expectedOut);
    assertEq(usdc.balanceOf(receiver), amountOut);
    assertEq(address(this).balance, balance - amountIn);
    assertEq(address(mockSwapper).balance, 0);
    assertEq(weth.balanceOf(address(mockSwapper)), 0);
  }

  function test_swapExactAmountOut_refundsNative() external {
    uint256 balance = address(this).balance;
    uint256 expectedIn = mockSwapper.getAmountIn(address(0), 100e6, address(usdc));

    uint256 amountIn =
      mockSwapper.swapExactAmountOut{ value: 1 ether }(address(0), 1 ether, address(usdc), 100e6, receiver);

    assertEq(amountIn, expectedIn);
    assertEq(usdc.balanceOf(receiver), 100e6);
    assertEq(address(this).balance, balance - amountIn);
    assertEq(address(mockSwapper).balance, 0);
  }

  function test_swapExactAmountIn_deliversNative(uint256 amountIn) external {
    amountIn = bound(amountIn, 1e6, 10_000e6);
    usdc.approve(address(mockSwapper), amountIn);
    uint256 expectedOut = mockSwapper.getAmountOut(address(usdc), amountIn, address(0));

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiGenericSwapCompleted(
      bytes32(0), "exa_app", "exa_app", receiver, address(usdc), address(0), amountIn, expectedOut
    );
    uint256 amountOut = mockSwapper.swapExactAmountIn(address(usdc), amountIn, address(0), expectedOut, receiver);

    assertEq(amountOut, expectedOut);
    assertEq(receiver.balance, amountOut);
    assertEq(weth.balanceOf(receiver), 0);
    assertEq(address(mockSwapper).balance, 0);
  }

  function test_swapExactAmountIn_wrapsNative(uint256 amount) external {
    amount = bound(amount, 1, 10 ether);
    assertEq(mockSwapper.getAmountOut(address(0), amount, address(weth)), amount);

    mockSwapper.swapExactAmountIn{ value: amount }(address(0), amount, address(weth), amount, receiver);

    assertEq(weth.balanceOf(receiver), amount);
  }

  function test_swapExactAmountIn_unwrapsNative(uint256 amount) external {
    amount = bound(amount, 1, 10 ether);
    weth.deposit{ value: amount }();
    weth.approve(address(mockSwapper), amount);

    mockSwapper.swapExactAmountIn(address(weth), amount, address(0), amount, receiver);

    assertEq(receiver.balance, amount);
    assertEq(weth.balanceOf(address(this)), 0);
  }

  function test_swapExactAmountIn_reverts_whenValueIsShort() external {
    vm.expectRevert(InvalidValue.selector);
    mockSwapper.swapExactAmountIn{ value: 1 ether - 1 }(address(0), 1 ether, address(usdc), 0, receiver);
  }

  function test_swapExactAmountIn_reverts_whenValueSentWithToken() external {
    exa.approve(address(mockSwapper), 1e18);
    vm.expectRevert(InvalidValue.selector);
    mockSwapper.swapExactAmountIn{ value: 1 }(address(exa), 1e18, address(usdc), 0, receiver);
  }

  function test_startBridgeTokensViaMock_bridgesNative() external {
    BridgeData memory data = bridgeData(address(0), 1 ether);
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferStarted(data);
    mockSwapper.startBridgeTokensViaMock{ value: 1 ether }(data);
    assertEq(address(mockSwapper).balance, 1 ether);
  }

  function test_startBridgeTokensViaMock_reverts_whenValueMismatches() external {
    vm.expectRevert(InvalidValue.selector);
    mockSwapper.startBridgeTokensViaMock{ value: 1 ether - 1 }(bridgeData(address(0), 1 ether));

    usdc.approve(address(mockSwapper), 1e6);
    vm.expectRevert(InvalidValue.selector);
    mockSwapper.startBridgeTokensViaMock{ value: 1 }(bridgeData(address(usdc), 1e6));
  }

  function test_swapAndStartBridgeTokensViaMock_bridgesToNative() external {
    uint256 expectedOut = mockSwapper.getAmountOut(address(usdc), 100e6, address(0));
    usdc.approve(address(mockSwapper), 100e6);
    BridgeData memory data = bridgeData(address(0), expectedOut);
    data.hasSourceSwaps = true;

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferStarted(data);
    mockSwapper.swapAndStartBridgeTokensViaMock(data, address(usdc), 100e6);

    assertEq(address(mockSwapper).balance, expectedOut);
    assertEq(weth.balanceOf(address(mockSwapper)), 0);
  }

  function test_swapAndStartBridgeTokensViaMock_bridgesFromNativeThroughHub() external {
    uint256 expectedOut = mockSwapper.getAmountOut(address(0), 1 ether, address(exa));
    BridgeData memory data = bridgeData(address(exa), expectedOut);
    data.hasSourceSwaps = true;
    uint256 balance = exa.balanceOf(address(mockSwapper));

    mockSwapper.swapAndStartBridgeTokensViaMock{ value: 1 ether }(data, address(0), 1 ether);

    assertEq(exa.balanceOf(address(mockSwapper)), balance + expectedOut);
  }

  function test_completeBridgeTokensViaMock_deliversNative() external {
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferCompleted(keccak256("native"), address(0), receiver, 1 ether, block.timestamp);
    mockSwapper.completeBridgeTokensViaMock{ value: 1 ether }(keccak256("native"), address(0), receiver, 1 ether);

    assertEq(receiver.balance, 1 ether);
    assertTrue(mockSwapper.completed(keccak256("native")));
  }

  function test_getPeripheryContract_returnsTokenWrapper() external view {
    address wrapper = mockSwapper.getPeripheryContract("TokenWrapper");
    assertEq(wrapper, address(mockSwapper.TOKEN_WRAPPER()));
    assertEq(mockSwapper.TOKEN_WRAPPER().wrappedToken(), address(weth));
    assertEq(mockSwapper.getPeripheryContract("Executor"), address(0));
  }

  function test_swapTokensSingleV3ERC20ToNative_unwraps(uint256 amount) external {
    amount = bound(amount, 1, 10 ether);
    weth.deposit{ value: amount }();
    weth.approve(address(mockSwapper), amount);
    weth.mint(address(mockSwapper), 5 ether);

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiGenericSwapCompleted(bytes32(0), "exa_app", "", receiver, address(weth), address(0), amount, amount);
    mockSwapper.swapTokensSingleV3ERC20ToNative(bytes32(0), "exa_app", "", receiver, amount, wrapperSwap(amount));

    assertEq(receiver.balance, amount);
    assertEq(weth.balanceOf(address(this)), 0);
    assertEq(weth.balanceOf(address(mockSwapper)), 5 ether);
    assertEq(address(mockSwapper).balance, 0);
  }

  function test_swapTokensSingleV3ERC20ToNative_reverts_whenOutputBelowMin() external {
    weth.deposit{ value: 1 ether }();
    weth.approve(address(mockSwapper), 1 ether);
    SwapData memory swap = wrapperSwap(1 ether);
    vm.expectRevert(InsufficientOutputAmount.selector);
    mockSwapper.swapTokensSingleV3ERC20ToNative(bytes32(0), "exa_app", "", receiver, 1 ether + 1, swap);
  }

  function test_swapTokensSingleV3ERC20ToNative_reverts_whenCallIsNotWrapper() external {
    SwapData memory swap = wrapperSwap(1 ether);
    swap.callTo = address(usdc);
    swap.callData = abi.encodeCall(usdc.transfer, (address(this), 1e6));
    vm.expectRevert(UnsupportedSwap.selector);
    mockSwapper.swapTokensSingleV3ERC20ToNative(bytes32(0), "exa_app", "", receiver, 0, swap);

    swap = wrapperSwap(1 ether);
    swap.approveTo = address(this);
    vm.expectRevert(UnsupportedSwap.selector);
    mockSwapper.swapTokensSingleV3ERC20ToNative(bytes32(0), "exa_app", "", receiver, 0, swap);

    swap = wrapperSwap(1 ether);
    swap.receivingAssetId = address(weth);
    vm.expectRevert(UnsupportedSwap.selector);
    mockSwapper.swapTokensSingleV3ERC20ToNative(bytes32(0), "exa_app", "", receiver, 0, swap);
  }

  function test_startBridgeTokensAndCallViaMock_emitsMessage() external {
    BridgeData memory data = bridgeData(address(usdc), 100e6);
    data.hasDestinationCall = true;
    bytes memory message = depositMessage(100e6);
    usdc.approve(address(mockSwapper), 100e6);

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferStarted(data);
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit BridgeMessage(data.transactionId, message);
    mockSwapper.startBridgeTokensAndCallViaMock(data, message);

    assertEq(usdc.balanceOf(address(mockSwapper)), 1_000_000e6 + 100e6);
  }

  function test_swapAndStartBridgeTokensAndCallViaMock_emitsMessage() external {
    uint256 expectedOut = mockSwapper.getAmountOut(address(exa), 10e18, address(usdc));
    BridgeData memory data = bridgeData(address(usdc), expectedOut - 1);
    data.hasSourceSwaps = true;
    data.hasDestinationCall = true;
    bytes memory message = depositMessage(expectedOut - 1);
    exa.approve(address(mockSwapper), 10e18);

    BridgeData memory started = bridgeData(address(usdc), expectedOut);
    started.hasSourceSwaps = true;
    started.hasDestinationCall = true;
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferStarted(started);
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit BridgeMessage(data.transactionId, message);
    mockSwapper.swapAndStartBridgeTokensAndCallViaMock(data, address(exa), 10e18, message);
  }

  function test_completeBridgeTokensAndCallViaMock_executesCalls(uint256 assets) external {
    assets = bound(assets, 1e6, 100e6);

    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferCompleted(keccak256("call"), address(usdc), receiver, 100e6, block.timestamp);
    mockSwapper.completeBridgeTokensAndCallViaMock(keccak256("call"), address(usdc), 100e6, depositMessage(assets));

    assertEq(exaUSDC.maxWithdraw(receiver), assets);
    assertEq(usdc.balanceOf(receiver), 100e6 - assets);
    assertEq(usdc.allowance(address(mockSwapper), address(exaUSDC)), 0);
    assertTrue(mockSwapper.completed(keccak256("call")));
  }

  function test_completeBridgeTokensAndCallViaMock_fallsBack_whenCallReverts() external {
    vm.expectEmit(true, true, true, true, address(mockSwapper));
    emit LiFiTransferCompleted(keccak256("call"), address(usdc), receiver, 100e6, block.timestamp);
    mockSwapper.completeBridgeTokensAndCallViaMock(keccak256("call"), address(usdc), 100e6, depositMessage(101e6));

    assertEq(exaUSDC.balanceOf(receiver), 0);
    assertEq(usdc.balanceOf(receiver), 100e6);
  }

  function test_completeBridgeTokensAndCallViaMock_fallsBack_whenCallsSpendMoreThanBridged() external {
    SwapData[] memory calls = new SwapData[](1);
    calls[0] = depositCall(100e6);
    calls[0].fromAmount = 200e6;
    calls[0].callData = abi.encodeCall(exaUSDC.deposit, (200e6, receiver));

    mockSwapper.completeBridgeTokensAndCallViaMock(
      keccak256("call"), address(usdc), 100e6, abi.encode(keccak256("call"), calls, receiver)
    );

    assertEq(exaUSDC.balanceOf(receiver), 0);
    assertEq(usdc.balanceOf(receiver), 100e6);
    assertEq(usdc.balanceOf(address(mockSwapper)), 1_000_000e6 - 100e6);
  }

  function test_completeBridgeTokensAndCallViaMock_reverts_whenCompleted() external {
    mockSwapper.completeBridgeTokensAndCallViaMock(keccak256("call"), address(usdc), 1e6, depositMessage(1e6));
    vm.expectRevert(AlreadyCompleted.selector);
    mockSwapper.completeBridgeTokensAndCallViaMock(keccak256("call"), address(usdc), 1e6, depositMessage(1e6));
  }

  function test_executeViaMock_reverts_whenNotSelf() external {
    vm.expectRevert(NotSelf.selector);
    mockSwapper.executeViaMock(address(usdc), 1e6, new SwapData[](0), receiver);
  }

  // solhint-enable func-name-mixedcase

  function bridgeData(address asset, uint256 amount) internal view returns (BridgeData memory) {
    return BridgeData({
      transactionId: keccak256("bridge"),
      bridge: "mock",
      integrator: "exa_app",
      referrer: address(0),
      sendingAssetId: asset,
      receiver: receiver,
      minAmount: amount,
      destinationChainId: 31_338,
      hasSourceSwaps: false,
      hasDestinationCall: false
    });
  }

  function depositCall(uint256 assets) internal view returns (SwapData memory) {
    return SwapData({
      callTo: address(exaUSDC),
      approveTo: address(exaUSDC),
      sendingAssetId: address(usdc),
      receivingAssetId: address(usdc),
      fromAmount: assets,
      callData: abi.encodeCall(exaUSDC.deposit, (assets, receiver)),
      requiresDeposit: false
    });
  }

  function depositMessage(uint256 assets) internal view returns (bytes memory) {
    SwapData[] memory calls = new SwapData[](1);
    calls[0] = depositCall(assets);
    return abi.encode(keccak256("call"), calls, receiver);
  }

  function wrapperSwap(uint256 amount) internal view returns (SwapData memory) {
    address wrapper = address(mockSwapper.TOKEN_WRAPPER());
    return SwapData({
      callTo: wrapper,
      approveTo: wrapper,
      sendingAssetId: address(weth),
      receivingAssetId: address(0),
      fromAmount: amount,
      callData: abi.encodeWithSignature("withdraw()"),
      requiresDeposit: true
    });
  }

  receive() external payable { } // solhint-disable-line no-empty-blocks
}
