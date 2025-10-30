// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0; // solhint-disable-line one-contract-per-file

import { OwnableRoles } from "solady/auth/OwnableRoles.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

interface IUniswapV3FlashCallback {
  function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external;
}

interface IUniswapV3SwapCallback {
  function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external;
}

contract Liquidator is OwnableRoles, IUniswapV3FlashCallback, IUniswapV3SwapCallback {
  using SafeTransferLib for address;

  /// @dev The minimum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MIN_TICK)
  uint160 internal constant MIN_SQRT_RATIO = 4_295_128_739;
  /// @dev The maximum value that can be returned from #getSqrtRatioAtTick. Equivalent to getSqrtRatioAtTick(MAX_TICK)
  uint160 internal constant MAX_SQRT_RATIO = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;

  IAuditor public immutable AUDITOR;
  address public immutable UNISWAP3_FACTORY;
  address public immutable UNISWAP3_ROUTER02;
  IVelodromeFactory public immutable VELODROME_FACTORY;

  constructor(
    address owner_,
    address auditor,
    address uniswap3Factory,
    address uniswap3Router02,
    address velodromeFactory
  ) {
    if (
      owner_ == address(0) || auditor == address(0) || uniswap3Factory == address(0) || uniswap3Router02 == address(0)
        || velodromeFactory == address(0)
    ) revert NewOwnerIsZeroAddress();
    _initializeOwner(owner_);
    AUDITOR = IAuditor(auditor);
    UNISWAP3_FACTORY = uniswap3Factory;
    UNISWAP3_ROUTER02 = uniswap3Router02;
    VELODROME_FACTORY = IVelodromeFactory(velodromeFactory);
  }

  function liquidateUniswap(
    address repayMarket,
    address seizeMarket,
    address borrower,
    uint256 maxRepay,
    address poolPair,
    uint24 fee,
    uint24 pairFee
  ) external onlyRolesOrOwner(1) {
    _checkShortfall(borrower);
    address repayAsset = IMarket(repayMarket).asset();
    uint256 availableRepay = repayAsset.balanceOf(address(this));

    if (availableRepay >= maxRepay) {
      repayAsset.safeApprove(address(repayMarket), maxRepay);
      IMarket(repayMarket).liquidate(borrower, maxRepay, seizeMarket);
    } else {
      uint256 flashBorrow = maxRepay - availableRepay;
      if (repayMarket != seizeMarket) {
        PoolAddress.PoolKey memory poolKey;
        bytes memory data;
        if (poolPair == address(0)) {
          address seizeAsset = IMarket(seizeMarket).asset();
          poolKey = PoolAddress.getPoolKey(repayAsset, seizeAsset, fee);
          data = abi.encode(
            SwapCallbackData({
              repayMarket: repayMarket,
              seizeMarket: seizeMarket,
              borrower: borrower,
              poolPair: seizeAsset,
              fee: fee,
              pairFee: 0
            })
          );
        } else {
          poolKey = PoolAddress.getPoolKey(repayAsset, poolPair, fee);
          data = abi.encode(
            SwapCallbackData({
              repayMarket: repayMarket,
              seizeMarket: seizeMarket,
              borrower: borrower,
              poolPair: poolPair,
              fee: fee,
              pairFee: pairFee
            })
          );
        }
        IUniswapV3Pool(PoolAddress.computeAddress(UNISWAP3_FACTORY, poolKey)).swap(
          address(this),
          repayAsset == poolKey.token1,
          -int256(maxRepay),
          repayAsset == poolKey.token1 ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
          data
        );
      } else {
        PoolAddress.PoolKey memory poolKey = PoolAddress.getPoolKey(repayAsset, poolPair, fee);
        bytes memory data = abi.encode(
          FlashCallbackData({
            repayMarket: repayMarket,
            seizeMarket: seizeMarket,
            borrower: borrower,
            maxRepay: maxRepay,
            flashBorrow: flashBorrow,
            poolPair: poolPair,
            fee: fee
          })
        );
        IUniswapV3Pool(PoolAddress.computeAddress(UNISWAP3_FACTORY, poolKey)).flash(
          address(this),
          repayAsset == poolKey.token0 ? flashBorrow : 0,
          repayAsset == poolKey.token1 ? flashBorrow : 0,
          data
        );
      }
    }
  }

  function liquidateVelodrome(
    address repayMarket,
    address seizeMarket,
    address borrower,
    uint256 maxRepay,
    address poolPair,
    bool isStable,
    bool isPairStable
  ) external onlyRolesOrOwner(1) {
    _checkShortfall(borrower);
    // slither-disable-next-line uninitialized-local
    LiquidateVars memory v;
    v.repayAsset = IMarket(repayMarket).asset();

    if (v.repayAsset.balanceOf(address(this)) >= maxRepay) {
      v.repayAsset.safeApprove(address(repayMarket), maxRepay);
      IMarket(repayMarket).liquidate(borrower, maxRepay, seizeMarket);
    } else {
      if (repayMarket == seizeMarket) revert Unsupported();
      if (poolPair == address(0)) {
        v.seizeAsset = IMarket(seizeMarket).asset();
        v.pool = VELODROME_FACTORY.getPool(v.repayAsset, v.seizeAsset, isStable);
        IVelodromePool(v.pool).swap(
          v.seizeAsset > v.repayAsset ? maxRepay : 0,
          v.seizeAsset < v.repayAsset ? maxRepay : 0,
          address(this),
          abi.encode(
            VelodromeCallbackData({
              repayMarket: repayMarket,
              seizeMarket: seizeMarket,
              borrower: borrower,
              poolPair: v.seizeAsset,
              fee: VELODROME_FACTORY.getFee(v.pool, isStable),
              pairFee: 0,
              isStable: isStable,
              isPairStable: false
            })
          )
        );
      } else {
        v.pool = VELODROME_FACTORY.getPool(v.repayAsset, poolPair, isStable);
        IVelodromePool(v.pool).swap(
          poolPair > v.repayAsset ? maxRepay : 0,
          poolPair < v.repayAsset ? maxRepay : 0,
          address(this),
          abi.encode(
            VelodromeCallbackData({
              repayMarket: repayMarket,
              seizeMarket: seizeMarket,
              borrower: borrower,
              poolPair: poolPair,
              fee: 0,
              pairFee: VELODROME_FACTORY.getFee(v.pool, isStable),
              isStable: isStable,
              isPairStable: isPairStable
            })
          )
        );
      }
    }
  }

  function hook(address sender, uint256 amount0Out, uint256 amount1Out, bytes calldata data) external {
    if (sender != address(this)) revert Unauthorized();

    VelodromeCallbackData memory v = abi.decode(data, (VelodromeCallbackData));
    address seizeAsset = IMarket(v.seizeMarket).asset();

    if (v.borrower != address(0)) {
      address repayAsset = IMarket(v.repayMarket).asset();
      if (msg.sender != VELODROME_FACTORY.getPool(repayAsset, v.poolPair, v.isStable)) revert Unauthorized();

      uint256 maxRepay = amount0Out == 0 ? amount1Out : amount0Out;
      repayAsset.safeApprove(address(v.repayMarket), maxRepay);
      IMarket(v.repayMarket).liquidate(v.borrower, maxRepay, v.seizeMarket);

      if (v.pairFee > 0) {
        address pool = VELODROME_FACTORY.getPool(seizeAsset, v.poolPair, v.isPairStable);
        uint256 amount = getAmountIn(msg.sender, maxRepay, amount0Out == 0, v.pairFee);

        IVelodromePool(pool).swap(
          seizeAsset > v.poolPair ? amount : 0,
          seizeAsset < v.poolPair ? amount : 0,
          address(this),
          abi.encode(
            VelodromeCallbackData({
              repayMarket: address(0),
              seizeMarket: v.seizeMarket,
              borrower: address(0),
              poolPair: v.poolPair,
              fee: VELODROME_FACTORY.getFee(pool, v.isPairStable),
              pairFee: 0,
              isStable: false,
              isPairStable: v.isPairStable
            })
          )
        );

        v.poolPair.safeTransfer(msg.sender, amount);
      } else {
        seizeAsset.safeTransfer(msg.sender, getAmountIn(msg.sender, maxRepay, amount0Out == 0, v.fee));
      }
    } else {
      if (msg.sender != VELODROME_FACTORY.getPool(v.poolPair, seizeAsset, v.isPairStable)) revert Unauthorized();
      seizeAsset.safeTransfer(
        msg.sender, getAmountIn(msg.sender, amount0Out == 0 ? amount1Out : amount0Out, amount0Out == 0, v.fee)
      );
    }
  }

  // slither-disable-next-line similar-names
  function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data) external {
    SwapCallbackData memory s = abi.decode(data, (SwapCallbackData));
    address seizeAsset = IMarket(s.seizeMarket).asset();
    if (s.borrower != address(0)) {
      address repayAsset = IMarket(s.repayMarket).asset();
      PoolAddress.PoolKey memory poolKey = PoolAddress.getPoolKey(repayAsset, s.poolPair, s.fee);
      if (msg.sender != PoolAddress.computeAddress(UNISWAP3_FACTORY, poolKey)) revert Unauthorized();

      uint256 maxRepay = uint256(-(repayAsset == poolKey.token0 ? amount0Delta : amount1Delta));
      repayAsset.safeApprove(address(s.repayMarket), maxRepay);
      IMarket(s.repayMarket).liquidate(s.borrower, maxRepay, s.seizeMarket);
      if (s.pairFee > 0) {
        PoolAddress.PoolKey memory swapPoolKey = PoolAddress.getPoolKey(seizeAsset, s.poolPair, s.pairFee);
        IUniswapV3Pool(PoolAddress.computeAddress(UNISWAP3_FACTORY, swapPoolKey)).swap(
          address(this),
          seizeAsset == swapPoolKey.token0,
          -int256(s.poolPair == poolKey.token0 ? amount0Delta : amount1Delta),
          seizeAsset == swapPoolKey.token0 ? MIN_SQRT_RATIO + 1 : MAX_SQRT_RATIO - 1,
          abi.encode(
            SwapCallbackData({
              repayMarket: address(0),
              seizeMarket: s.seizeMarket,
              borrower: address(0),
              poolPair: s.poolPair,
              fee: 0,
              pairFee: s.pairFee
            })
          )
        );

        s.poolPair.safeTransfer(msg.sender, uint256(s.poolPair == poolKey.token0 ? amount0Delta : amount1Delta));
      } else {
        seizeAsset.safeTransfer(msg.sender, uint256(seizeAsset == poolKey.token0 ? amount0Delta : amount1Delta));
      }
    } else {
      PoolAddress.PoolKey memory swapPoolKey = PoolAddress.getPoolKey(seizeAsset, s.poolPair, s.pairFee);
      if (msg.sender != PoolAddress.computeAddress(UNISWAP3_FACTORY, swapPoolKey)) revert Unauthorized();

      seizeAsset.safeTransfer(msg.sender, uint256(seizeAsset == swapPoolKey.token0 ? amount0Delta : amount1Delta));
    }
  }

  function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external {
    FlashCallbackData memory f = abi.decode(data, (FlashCallbackData));
    address repayAsset = IMarket(f.repayMarket).asset();
    PoolAddress.PoolKey memory poolKey = PoolAddress.getPoolKey(repayAsset, f.poolPair, f.fee);

    if (msg.sender != PoolAddress.computeAddress(UNISWAP3_FACTORY, poolKey)) revert Unauthorized();

    repayAsset.safeApprove(address(f.repayMarket), f.maxRepay);
    IMarket(f.repayMarket).liquidate(f.borrower, f.maxRepay, f.seizeMarket);

    repayAsset.safeTransfer(msg.sender, f.flashBorrow + (repayAsset == poolKey.token0 ? fee0 : fee1));
  }

  function getAmountIn(address pool, uint256 amountOut, bool isToken0, uint256 fee) internal view returns (uint256) {
    (uint256 reserve0, uint256 reserve1,) = IVelodromePool(pool).getReserves();
    return (
      isToken0
        ? (reserve0 * amountOut * 10_000) / ((reserve1 - amountOut) * (10_000 - fee))
        : (reserve1 * amountOut * 10_000) / ((reserve0 - amountOut) * (10_000 - fee))
    ) + 1;
  }

  function swap(address assetIn, uint256 amountIn, address assetOut, uint256 amountOutMinimum, uint24 fee)
    external
    onlyOwner
  {
    assetIn.safeApprove(UNISWAP3_ROUTER02, amountIn);
    ISwapRouter02(UNISWAP3_ROUTER02).exactInputSingle(
      ISwapRouter02.ExactInputSingleParams({
        tokenIn: assetIn,
        tokenOut: assetOut,
        fee: fee,
        recipient: address(this),
        amountIn: amountIn,
        amountOutMinimum: amountOutMinimum,
        sqrtPriceLimitX96: 0
      })
    );
  }

  function transfer(address asset, address to, uint256 amount) external onlyOwner {
    asset.safeTransfer(to, amount);
  }

  function _checkShortfall(address account) internal view {
    (uint256 adjustedCollateral, uint256 adjustedDebt) = AUDITOR.accountLiquidity(account, address(0), 0);
    if (adjustedCollateral >= adjustedDebt) revert InsufficientShortfall();
  }

  error InsufficientShortfall();
  error Unsupported();
}

library PoolAddress {
  bytes32 internal constant POOL_INIT_CODE_HASH = 0xe34f199b19b2b4f47f68442619d555527d244f78a3297ea89325f843f87b8b54;

  function getPoolKey(address tokenA, address tokenB, uint24 fee) internal pure returns (PoolKey memory) {
    if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
    return PoolKey({ token0: tokenA, token1: tokenB, fee: fee });
  }

  function computeAddress(address factory, PoolKey memory key) internal pure returns (address pool) {
    if (key.token0 >= key.token1) revert InvalidPoolKey();
    pool = address(
      uint160(
        uint256(
          keccak256(
            abi.encodePacked(
              hex"ff", factory, keccak256(abi.encode(key.token0, key.token1, key.fee)), POOL_INIT_CODE_HASH
            )
          )
        )
      )
    );
  }

  struct PoolKey {
    address token0;
    address token1;
    uint24 fee;
  }

  error InvalidPoolKey();
}

struct LiquidateVars {
  address repayAsset;
  address seizeAsset;
  address pool;
}

struct VelodromeCallbackData {
  address repayMarket;
  address seizeMarket;
  address borrower;
  address poolPair;
  uint24 fee;
  uint24 pairFee;
  bool isStable;
  bool isPairStable;
}

struct SwapCallbackData {
  address repayMarket;
  address seizeMarket;
  address borrower;
  address poolPair;
  uint24 fee;
  uint24 pairFee;
}

struct FlashCallbackData {
  address repayMarket;
  address seizeMarket;
  address borrower;
  uint256 maxRepay;
  uint256 flashBorrow;
  address poolPair;
  uint24 fee;
}

interface IAuditor {
  function accountLiquidity(address account, address, uint256) external view returns (uint256 collateral, uint256 debt);
}

interface IMarket {
  function asset() external view returns (address);
  function liquidate(address borrower, uint256 maxAssets, address seizeMarket) external returns (uint256 repaidAssets);
}

interface IUniswapV3Pool {
  function flash(address recipient, uint256 amount0, uint256 amount1, bytes calldata data) external;
  function swap(
    address recipient,
    bool zeroForOne,
    int256 amountSpecified,
    uint160 sqrtPriceLimitX96,
    bytes calldata data
  ) external returns (int256 amount0, int256 amount1);
}

interface IVelodromeFactory {
  function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
  function getFee(address pool, bool stable) external view returns (uint24);
}

interface IVelodromePool {
  function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
  function getReserves() external view returns (uint256 reserve0, uint256 reserve1, uint256 blockTimestampLast);
}

interface ISwapRouter02 is IUniswapV3SwapCallback {
  function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);

  struct ExactInputSingleParams {
    address tokenIn;
    address tokenOut;
    uint24 fee;
    address recipient;
    uint256 amountIn;
    uint256 amountOutMinimum;
    uint160 sqrtPriceLimitX96;
  }
}
