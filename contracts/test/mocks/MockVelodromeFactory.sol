// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20; // solhint-disable-line one-contract-per-file

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC20Metadata } from "openzeppelin-contracts/contracts/interfaces/IERC20Metadata.sol";
import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import { LibClone } from "solady/utils/LibClone.sol";

interface IVelodromeFactory {
  function getFee(address pool, bool stable) external view returns (uint24);
  function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
}

interface IVelodromePool {
  function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
  function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast);
}

contract MockVelodromeFactory is IVelodromeFactory {
  using SafeERC20 for IERC20;
  using LibClone for address;

  mapping(address tokenA => mapping(address tokenB => mapping(bool stable => address pool))) public getPool;
  mapping(address pool => bool) public isPool;

  address internal immutable IMPL;

  constructor() {
    IMPL = address(new MockVelodromePool());
  }

  function getFee(address, bool stable) external pure returns (uint24) {
    return stable ? 5 : 30;
  }

  function createPool(address tokenA, address tokenB, bool stable) public returns (MockVelodromePool pool) {
    if (tokenA == tokenB) revert SameAddress();
    (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
    if (token0 == address(0)) revert ZeroAddress();
    if (address(getPool[token0][token1][stable]) != address(0)) revert PoolAlreadyExists();
    pool = MockVelodromePool(IMPL.deployDeterministicERC1967(keccak256(abi.encodePacked(token0, token1, stable))));
    pool.initialize(token0, token1, stable);
    getPool[token0][token1][stable] = address(pool);
    getPool[token1][token0][stable] = address(pool);
    isPool[address(pool)] = true;
  }
}

contract MockVelodromePool is IVelodromePool {
  using SafeERC20 for IERC20;

  IVelodromeFactory public factory;
  IERC20 public token0;
  IERC20 public token1;
  bool public stable;
  uint256 public reserve0;
  uint256 public reserve1;
  uint256 public blockTimestampLast;

  uint256 internal decimals0;
  uint256 internal decimals1;

  function initialize(address token0_, address token1_, bool stable_) external {
    (token0, token1, stable) = (IERC20(token0_), IERC20(token1_), stable_);
    factory = IVelodromeFactory(msg.sender);

    decimals0 = 10 ** IERC20Metadata(token0_).decimals();
    decimals1 = 10 ** IERC20Metadata(token1_).decimals();
  }

  function getReserves() external view returns (uint256 reserve0_, uint256 reserve1_, uint256 blockTimestampLast_) {
    (reserve0_, reserve1_, blockTimestampLast_) = (reserve0, reserve1, blockTimestampLast);
  }

  function poke() external {
    reserve0 = token0.balanceOf(address(this));
    reserve1 = token1.balanceOf(address(this));
    blockTimestampLast = block.timestamp;
  }

  function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external {
    if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
    (uint256 reserve0_, uint256 reserve1_) = (reserve0, reserve1);
    if (amount0Out >= reserve0_ || amount1Out >= reserve1_) revert InsufficientLiquidity(); // solhint-disable-line gas-strict-inequalities,max-line-length

    uint256 balance0;
    uint256 balance1;
    {
      (IERC20 token0_, IERC20 token1_) = (token0, token1);
      if (to == address(token0_) || to == address(token1_)) revert InvalidTo();
      if (amount0Out > 0) token0_.safeTransfer(to, amount0Out);
      if (amount1Out > 0) token1_.safeTransfer(to, amount1Out);
      if (data.length > 0) IPoolCallee(to).hook(msg.sender, amount0Out, amount1Out, data);
      balance0 = token0_.balanceOf(address(this));
      balance1 = token1_.balanceOf(address(this));
    }
    uint256 amount0In = balance0 > reserve0_ - amount0Out ? balance0 - (reserve0_ - amount0Out) : 0;
    uint256 amount1In = balance1 > reserve1_ - amount1Out ? balance1 - (reserve1_ - amount1Out) : 0;
    if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();
    {
      (IERC20 token0_, IERC20 token1_) = (token0, token1);
      if (amount0In > 0) {
        token0.safeTransfer(address(factory), (amount0In * factory.getFee(address(this), stable)) / 10_000);
      }
      if (amount1In > 0) {
        token1.safeTransfer(address(factory), (amount1In * factory.getFee(address(this), stable)) / 10_000);
      }
      balance0 = token0_.balanceOf(address(this));
      balance1 = token1_.balanceOf(address(this));
      if (_k(balance0, balance1) < _k(reserve0_, reserve1_)) revert K();
    }

    reserve0 = balance0;
    reserve1 = balance1;
    blockTimestampLast = block.timestamp;
  }

  function _k(uint256 x, uint256 y) internal view returns (uint256) {
    if (stable) {
      uint256 _x = (x * 1e18) / decimals0;
      uint256 _y = (y * 1e18) / decimals1;
      uint256 _a = (_x * _y) / 1e18;
      uint256 _b = ((_x * _x) / 1e18 + (_y * _y) / 1e18);
      return (_a * _b) / 1e18; // x3y + y3x >= k
    } else {
      return x * y; // xy >= k
    }
  }
}

error InsufficientInputAmount();
error InsufficientLiquidity();
error InsufficientOutputAmount();
error InvalidTo();
error K();
error PoolAlreadyExists();
error SameAddress();
error ZeroAddress();

interface IPoolCallee {
  function hook(address sender, uint256 amount0, uint256 amount1, bytes calldata data) external;
}
