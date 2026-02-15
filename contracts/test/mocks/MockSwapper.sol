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

contract MockSwapper {
  using SafeERC20 for IERC20;

  IVelodromeFactory public immutable VELODROME_FACTORY;
  uint256 internal transactionCount;

  constructor(IVelodromeFactory velodromeFactory) {
    VELODROME_FACTORY = velodromeFactory;
  }

  function getAmountIn(address tokenIn, uint256 amountOut, address tokenOut) external view returns (uint256 amountIn) {
    address pool = VELODROME_FACTORY.getPool(tokenIn, tokenOut, false);
    uint24 swapFee = VELODROME_FACTORY.getFee(pool, false);
    bool isToken0 = tokenOut > tokenIn;
    return _getAmountIn(pool, amountOut, isToken0, swapFee);
  }

  function getAmountOut(address tokenIn, uint256 amountIn, address tokenOut) external view returns (uint256 amountOut) {
    address pool = VELODROME_FACTORY.getPool(tokenIn, tokenOut, false);
    uint24 swapFee = VELODROME_FACTORY.getFee(pool, false);
    bool isToken0 = tokenOut > tokenIn;
    return _getAmountOut(pool, amountIn, isToken0, swapFee);
  }

  function swapExactAmountOut(
    address tokenIn,
    uint256 maxAmountIn,
    address tokenOut,
    uint256 amountOut,
    address receiver
  ) external returns (uint256 amountIn) {
    address pool = VELODROME_FACTORY.getPool(tokenIn, tokenOut, false);
    uint24 swapFee = VELODROME_FACTORY.getFee(pool, false);
    bool isToken0 = tokenOut > tokenIn;
    amountIn = _getAmountIn(pool, amountOut, isToken0, swapFee);
    if (amountIn > maxAmountIn) revert InsufficientInputAmount();

    IERC20(tokenIn).safeTransferFrom(msg.sender, pool, amountIn);
    IVelodromePool(pool).swap(isToken0 ? 0 : amountOut, isToken0 ? amountOut : 0, receiver, "");

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
  ) external returns (uint256 amountOut) {
    address pool = VELODROME_FACTORY.getPool(tokenIn, tokenOut, false);
    uint24 swapFee = VELODROME_FACTORY.getFee(pool, false);
    bool isToken0 = tokenOut > tokenIn;
    amountOut = _getAmountOut(pool, amountIn, isToken0, swapFee);
    if (amountOut < minAmountOut) revert InsufficientOutputAmount();

    IERC20(tokenIn).safeTransferFrom(msg.sender, pool, amountIn);
    IVelodromePool(pool).swap(isToken0 ? 0 : amountOut, isToken0 ? amountOut : 0, receiver, "");

    // solhint-disable gas-increment-by-one
    emit LiFiGenericSwapCompleted(
      bytes32(transactionCount++), "exa_app", "exa_app", receiver, tokenIn, tokenOut, amountIn, amountOut
    );
    // solhint-enable gas-increment-by-one
  }

  function _getAmountIn(address pool, uint256 amountOut, bool isToken0, uint256 fee) internal view returns (uint256) {
    (uint256 reserve0, uint256 reserve1,) = IVelodromePool(pool).getReserves();
    return (isToken0
          ? (reserve0 * amountOut * 10_000) / ((reserve1 - amountOut) * (10_000 - fee))
          : (reserve1 * amountOut * 10_000) / ((reserve0 - amountOut) * (10_000 - fee))) + 1;
  }

  function _getAmountOut(address pool, uint256 amountIn, bool isToken0, uint256 fee) internal view returns (uint256) {
    (uint256 reserve0, uint256 reserve1,) = IVelodromePool(pool).getReserves();
    return (isToken0
        ? (reserve1 * amountIn * (10_000 - fee)) / (reserve0 * 10_000 + amountIn * (10_000 - fee))
        : (reserve0 * amountIn * (10_000 - fee)) / (reserve1 * 10_000 + amountIn * (10_000 - fee)));
  }
}

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
