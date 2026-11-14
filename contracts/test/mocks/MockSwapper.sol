// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import {
  IVelodromeFactory,
  IVelodromePool,
  InsufficientInputAmount,
  InsufficientOutputAmount
} from "./MockVelodromeFactory.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import { Address } from "openzeppelin-contracts/contracts/utils/Address.sol";

import { WETH } from "solady/tokens/WETH.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

contract MockSwapper {
  using SafeTransferLib for address;
  using SafeERC20 for IERC20;
  using Address for address;

  uint256 internal constant RECOVER_GAS = 100_000;
  IVelodromeFactory public immutable VELODROME_FACTORY;
  address public immutable HUB;
  WETH public immutable WRAPPED_NATIVE;
  MockTokenWrapper public immutable TOKEN_WRAPPER;
  uint256 internal transactionCount;
  mapping(bytes32 transactionId => bool completed) public completed;

  constructor(IVelodromeFactory velodromeFactory, address hub, WETH wrappedNative) {
    VELODROME_FACTORY = velodromeFactory;
    HUB = hub;
    WRAPPED_NATIVE = wrappedNative;
    TOKEN_WRAPPER = new MockTokenWrapper(wrappedNative);
  }

  function getAmountIn(address tokenIn, uint256 amountOut, address tokenOut) external view returns (uint256 amountIn) {
    return _amountsIn(_path(tokenIn, tokenOut), amountOut)[0];
  }

  function getAmountOut(address tokenIn, uint256 amountIn, address tokenOut) external view returns (uint256 amountOut) {
    address[] memory path = _path(tokenIn, tokenOut);
    return _amountsOut(path, amountIn)[path.length - 1];
  }

  function getPeripheryContract(string calldata name) external view returns (address) {
    return keccak256(bytes(name)) == keccak256("TokenWrapper") ? address(TOKEN_WRAPPER) : address(0);
  }

  function swapExactAmountOut(
    address tokenIn,
    uint256 maxAmountIn,
    address tokenOut,
    uint256 amountOut,
    address receiver
  ) external payable returns (uint256 amountIn) {
    address[] memory path = _path(tokenIn, tokenOut);
    uint256[] memory amounts = _amountsIn(path, amountOut);
    amountIn = amounts[0];
    if (amountIn > maxAmountIn) revert InsufficientInputAmount();
    _execute(tokenIn, path, amounts, tokenOut, receiver);

    // solhint-disable gas-increment-by-one
    emit LiFiGenericSwapCompleted(
      bytes32(transactionCount++), "exa_app", "exa_app", receiver, tokenIn, tokenOut, amountIn, amountOut
    );
    // solhint-enable gas-increment-by-one
  }

  function swapExactAmountIn(
    address tokenIn,
    uint256 amountIn,
    address tokenOut,
    uint256 minAmountOut,
    address receiver
  ) external payable returns (uint256 amountOut) {
    address[] memory path = _path(tokenIn, tokenOut);
    uint256[] memory amounts = _amountsOut(path, amountIn);
    amountOut = amounts[path.length - 1];
    if (amountOut < minAmountOut) revert InsufficientOutputAmount();
    _execute(tokenIn, path, amounts, tokenOut, receiver);

    // solhint-disable gas-increment-by-one
    emit LiFiGenericSwapCompleted(
      bytes32(transactionCount++), "exa_app", "exa_app", receiver, tokenIn, tokenOut, amountIn, amountOut
    );
    // solhint-enable gas-increment-by-one
  }

  function swapTokensSingleV3ERC20ToNative(
    bytes32 transactionId,
    string calldata integrator,
    string calldata referrer,
    address receiver,
    uint256 minAmountOut,
    SwapData calldata swapData
  ) external {
    if (
      swapData.callTo != address(TOKEN_WRAPPER) || swapData.approveTo != address(TOKEN_WRAPPER)
        || swapData.receivingAssetId != address(0)
    ) revert UnsupportedSwap();
    IERC20(swapData.sendingAssetId).safeTransferFrom(msg.sender, address(this), swapData.fromAmount);
    IERC20(swapData.sendingAssetId).forceApprove(swapData.approveTo, swapData.fromAmount);
    uint256 balance = address(this).balance;
    swapData.callTo.functionCall(swapData.callData);
    uint256 amountOut = address(this).balance - balance;
    if (amountOut < minAmountOut) revert InsufficientOutputAmount();
    receiver.safeTransferETH(amountOut);
    emit LiFiGenericSwapCompleted(
      transactionId, integrator, referrer, receiver, swapData.sendingAssetId, address(0), swapData.fromAmount, amountOut
    );
  }

  function startBridgeTokensViaMock(BridgeData calldata bridgeData) external payable {
    _start(bridgeData);
  }

  function startBridgeTokensAndCallViaMock(BridgeData calldata bridgeData, bytes calldata message) external payable {
    _start(bridgeData);
    emit BridgeMessage(bridgeData.transactionId, message);
  }

  function swapAndStartBridgeTokensViaMock(BridgeData calldata bridgeData, address fromAssetId, uint256 fromAmount)
    external
    payable
  {
    _swapAndStart(bridgeData, fromAssetId, fromAmount);
  }

  function swapAndStartBridgeTokensAndCallViaMock(
    BridgeData calldata bridgeData,
    address fromAssetId,
    uint256 fromAmount,
    bytes calldata message
  ) external payable {
    _swapAndStart(bridgeData, fromAssetId, fromAmount);
    emit BridgeMessage(bridgeData.transactionId, message);
  }

  function completeBridgeTokensViaMock(
    bytes32 transactionId,
    address receivingAssetId,
    address receiver,
    uint256 amount
  ) external payable {
    if (completed[transactionId]) revert AlreadyCompleted();
    completed[transactionId] = true;
    if (receivingAssetId == address(0)) receiver.safeTransferETH(amount);
    else IERC20(receivingAssetId).safeTransfer(receiver, amount);
    emit LiFiTransferCompleted(transactionId, receivingAssetId, receiver, amount, block.timestamp); // solhint-disable-line not-rely-on-time
  }

  function completeBridgeTokensAndCallViaMock(
    bytes32 transactionId,
    address receivingAssetId,
    uint256 amount,
    bytes calldata message
  ) external {
    if (completed[transactionId]) revert AlreadyCompleted();
    completed[transactionId] = true;
    (, SwapData[] memory calls, address receiver) = abi.decode(message, (bytes32, SwapData[], address));
    bytes memory data = abi.encodeCall(this.executeViaMock, (receivingAssetId, amount, calls, receiver));
    uint256 gasLeft = gasleft();
    bool success;
    if (gasLeft > RECOVER_GAS) (success,) = address(this).call{ gas: gasLeft - RECOVER_GAS }(data); // solhint-disable-line avoid-low-level-calls
    if (!success) IERC20(receivingAssetId).safeTransfer(receiver, amount);
    emit LiFiTransferCompleted(transactionId, receivingAssetId, receiver, amount, block.timestamp); // solhint-disable-line not-rely-on-time
  }

  function executeViaMock(address assetId, uint256 amount, SwapData[] calldata calls, address receiver) external {
    if (msg.sender != address(this)) revert NotSelf();
    uint256 balance = IERC20(assetId).balanceOf(address(this));
    for (uint256 i = 0; i < calls.length; ++i) {
      IERC20(calls[i].sendingAssetId).forceApprove(calls[i].approveTo, calls[i].fromAmount);
      calls[i].callTo.functionCall(calls[i].callData);
    }
    uint256 left = amount - (balance - IERC20(assetId).balanceOf(address(this)));
    if (left != 0) IERC20(assetId).safeTransfer(receiver, left);
  }

  receive() external payable { } // solhint-disable-line no-empty-blocks

  function _start(BridgeData calldata bridgeData) internal {
    if (msg.value != (bridgeData.sendingAssetId == address(0) ? bridgeData.minAmount : 0)) revert InvalidValue();
    if (bridgeData.sendingAssetId != address(0)) {
      IERC20(bridgeData.sendingAssetId).safeTransferFrom(msg.sender, address(this), bridgeData.minAmount);
    }
    emit LiFiTransferStarted(bridgeData);
  }

  function _swapAndStart(BridgeData calldata bridgeData, address fromAssetId, uint256 fromAmount) internal {
    address[] memory path = _path(fromAssetId, bridgeData.sendingAssetId);
    uint256[] memory amounts = _amountsOut(path, fromAmount);
    uint256 amountOut = amounts[path.length - 1];
    if (amountOut < bridgeData.minAmount) revert InsufficientOutputAmount();
    _execute(fromAssetId, path, amounts, bridgeData.sendingAssetId, address(this));

    BridgeData memory started = bridgeData;
    started.minAmount = amountOut;
    emit LiFiTransferStarted(started);
  }

  function _execute(
    address tokenIn,
    address[] memory path,
    uint256[] memory amounts,
    address tokenOut,
    address receiver
  ) internal {
    if (tokenIn == address(0) ? msg.value < amounts[0] : msg.value != 0) revert InvalidValue();
    uint256 last = path.length - 1;
    address destination = tokenOut == address(0) ? address(this) : receiver;
    address next = last == 0 ? destination : _pool(path[0], path[1]);
    if (tokenIn == address(0)) {
      WRAPPED_NATIVE.deposit{ value: amounts[0] }();
      if (next != address(this)) address(WRAPPED_NATIVE).safeTransfer(next, amounts[0]);
    } else {
      IERC20(tokenIn).safeTransferFrom(msg.sender, next, amounts[0]);
    }
    for (uint256 i = 1; i < path.length; ++i) {
      address pool = next;
      next = i == last ? destination : _pool(path[i], path[i + 1]);
      bool isToken0 = path[i] > path[i - 1];
      IVelodromePool(pool).swap(isToken0 ? 0 : amounts[i], isToken0 ? amounts[i] : 0, next, "");
    }
    if (tokenOut == address(0)) {
      WRAPPED_NATIVE.withdraw(amounts[last]);
      if (receiver != address(this)) receiver.safeTransferETH(amounts[last]);
    }
    if (msg.value > amounts[0]) msg.sender.safeTransferETH(msg.value - amounts[0]);
  }

  function _path(address tokenIn, address tokenOut) internal view returns (address[] memory path) {
    if (tokenIn == address(0)) tokenIn = address(WRAPPED_NATIVE);
    if (tokenOut == address(0)) tokenOut = address(WRAPPED_NATIVE);
    if (tokenIn == tokenOut) {
      path = new address[](1);
      path[0] = tokenIn;
    } else if (VELODROME_FACTORY.getPool(tokenIn, tokenOut, false) != address(0)) {
      path = new address[](2);
      (path[0], path[1]) = (tokenIn, tokenOut);
    } else {
      path = new address[](3);
      (path[0], path[1], path[2]) = (tokenIn, HUB, tokenOut);
    }
  }

  function _amountsIn(address[] memory path, uint256 amountOut) internal view returns (uint256[] memory amounts) {
    amounts = new uint256[](path.length);
    amounts[path.length - 1] = amountOut;
    for (uint256 i = path.length - 1; i > 0; --i) {
      amounts[i - 1] = _getAmountIn(path[i - 1], amounts[i], path[i]);
    }
  }

  function _amountsOut(address[] memory path, uint256 amountIn) internal view returns (uint256[] memory amounts) {
    amounts = new uint256[](path.length);
    amounts[0] = amountIn;
    for (uint256 i = 1; i < path.length; ++i) {
      amounts[i] = _getAmountOut(path[i - 1], amounts[i - 1], path[i]);
    }
  }

  function _getAmountIn(address tokenIn, uint256 amountOut, address tokenOut) internal view returns (uint256) {
    address pool = _pool(tokenIn, tokenOut);
    uint256 fee = VELODROME_FACTORY.getFee(pool, false);
    (uint256 reserve0, uint256 reserve1,) = IVelodromePool(pool).getReserves();
    return (tokenOut > tokenIn
          ? (reserve0 * amountOut * 10_000) / ((reserve1 - amountOut) * (10_000 - fee))
          : (reserve1 * amountOut * 10_000) / ((reserve0 - amountOut) * (10_000 - fee))) + 1;
  }

  function _getAmountOut(address tokenIn, uint256 amountIn, address tokenOut) internal view returns (uint256) {
    address pool = _pool(tokenIn, tokenOut);
    uint256 fee = VELODROME_FACTORY.getFee(pool, false);
    (uint256 reserve0, uint256 reserve1,) = IVelodromePool(pool).getReserves();
    return (tokenOut > tokenIn
        ? (reserve1 * amountIn * (10_000 - fee)) / (reserve0 * 10_000 + amountIn * (10_000 - fee))
        : (reserve0 * amountIn * (10_000 - fee)) / (reserve1 * 10_000 + amountIn * (10_000 - fee)));
  }

  function _pool(address tokenA, address tokenB) internal view returns (address pool) {
    pool = VELODROME_FACTORY.getPool(tokenA, tokenB, false);
    if (pool == address(0)) revert NoRoute();
  }
}

contract MockTokenWrapper {
  using SafeTransferLib for address;

  WETH internal immutable WRAPPED;

  constructor(WETH wrapped) {
    WRAPPED = wrapped;
  }

  function wrappedToken() external view returns (address) {
    return address(WRAPPED);
  }

  function withdraw() external {
    uint256 amount = WRAPPED.allowance(msg.sender, address(this));
    address(WRAPPED).safeTransferFrom(msg.sender, address(this), amount);
    WRAPPED.withdraw(amount);
    msg.sender.safeTransferETH(amount);
  }

  receive() external payable { } // solhint-disable-line no-empty-blocks
}

error AlreadyCompleted();
error InvalidValue();
error NoRoute();
error NotSelf();
error UnsupportedSwap();

// solhint-disable-next-line gas-struct-packing
struct BridgeData {
  bytes32 transactionId;
  string bridge;
  string integrator;
  address referrer;
  address sendingAssetId;
  address receiver;
  uint256 minAmount;
  uint256 destinationChainId;
  bool hasSourceSwaps;
  bool hasDestinationCall;
}

// solhint-disable-next-line gas-struct-packing
struct SwapData {
  address callTo;
  address approveTo;
  address sendingAssetId;
  address receivingAssetId;
  uint256 fromAmount;
  bytes callData;
  bool requiresDeposit;
}

event LiFiTransferStarted(BridgeData bridgeData);

event BridgeMessage(bytes32 indexed transactionId, bytes message);

event LiFiTransferCompleted(
  bytes32 indexed transactionId, address receivingAssetId, address receiver, uint256 amount, uint256 timestamp
);

event LiFiGenericSwapCompleted(
  bytes32 indexed transactionId,
  string integrator,
  string referrer,
  address receiver,
  address fromAssetId,
  address toAssetId,
  uint256 fromAmount,
  uint256 toAmount
);
