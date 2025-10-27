// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";
import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import { IPluginExecutor } from "modular-account-libs/interfaces/IPluginExecutor.sol";

import { WETH as IWETH } from "solady/tokens/WETH.sol";

import { Disagreement, IMarket } from "./IExaAccount.sol";

contract ExaPluginExtension {
  using SafeERC20 for IERC20;

  IERC20 private immutable USDC;
  IWETH private immutable WETH;
  IMarket private immutable EXA_USDC;
  IMarket private immutable EXA_WETH;

  // slither-disable-next-line unused-state,constable-states -- storage gap
  uint256 private __gap0;
  // slither-disable-next-line uninitialized-state,constable-states -- implementation contract
  address private flashLoaner;
  // slither-disable-next-line unused-state,constable-states -- storage gap
  uint256 private __gap1;
  // slither-disable-next-line uninitialized-state,constable-states -- implementation contract
  address private swapper;
  // slither-disable-next-line unused-state -- storage gap
  uint256[2] private __gap2;
  bytes32 private callHash;
  bytes32 private flashLoaning;

  constructor(IMarket exaUSDC, IMarket exaWETH) {
    USDC = IERC20(exaUSDC.asset());
    WETH = IWETH(payable(exaWETH.asset()));
    EXA_USDC = exaUSDC;
    EXA_WETH = exaWETH;
  }

  function receiveFlashLoan(IERC20[] calldata, uint256[] calldata, uint256[] calldata fees, bytes calldata data)
    external
  {
    address _flashLoaner = address(flashLoaner);
    // slither-disable-next-line incorrect-equality -- hash comparison
    assert(msg.sender == _flashLoaner && flashLoaning == keccak256(data));
    delete flashLoaning;

    if (data[0] == 0x01) {
      RepayCallbackData memory r = abi.decode(data[1:], (RepayCallbackData));
      if (r.market != EXA_USDC) IERC20(r.market.asset()).forceApprove(address(r.market), r.maxRepay);
      // slither-disable-next-line reentrancy-no-eth -- markets are safe
      uint256 actualRepay = r.market.repayAtMaturity(r.maturity, r.positionAssets, r.maxRepay, r.borrower);

      uint256 spent = actualRepay + fees[0];
      // slither-disable-next-line reentrancy-benign -- markets are safe
      callHash = keccak256(abi.encode(r.market, IERC4626.withdraw.selector, spent, address(this), r.borrower))
        | bytes32(uint256(1));
      _execute(r.borrower, address(r.market), 0, abi.encodeCall(IMarket.withdraw, (spent, address(this), r.borrower)));
      // slither-disable-next-line reentrancy-benign -- markets are safe
      delete callHash;
      IERC20(r.market.asset()).safeTransfer(_flashLoaner, r.maxRepay + fees[0]);
      return;
    }
    _handleCrossRepay(abi.decode(data[1:], (CrossRepayCallbackData)), fees[0]);
  }

  function _handleCrossRepay(CrossRepayCallbackData memory c, uint256 fee) internal {
    IERC20 assetOut = IERC20(c.marketOut.asset());
    if (assetOut != USDC) assetOut.forceApprove(address(c.marketOut), c.maxRepay);

    uint256 actualRepay = c.marketOut.repayAtMaturity(c.maturity, c.positionAssets, c.maxRepay, c.borrower);
    _execute(
      c.borrower, address(c.marketIn), 0, abi.encodeCall(IMarket.withdraw, (c.maxAmountIn, c.borrower, c.borrower))
    );
    IERC20 assetIn = IERC20(c.marketIn.asset());
    (uint256 amountIn, uint256 amountOut) = _swap(c.borrower, assetIn, assetOut, c.maxAmountIn, c.maxRepay, c.route);

    uint256 spent = actualRepay + fee;
    _transferFromAccount(c.borrower, assetOut, address(this), spent);
    assetOut.safeTransfer(flashLoaner, c.maxRepay + fee);

    uint256 unspent = amountOut - spent;
    if (_checkDeposit(c.marketOut, unspent)) {
      _execute(c.borrower, address(assetOut), 0, abi.encodeCall(IERC20.approve, (address(c.marketOut), unspent)));
      _execute(c.borrower, address(c.marketOut), 0, abi.encodeCall(IERC4626.deposit, (unspent, c.borrower)));
    }
    uint256 unspentCollateral = c.maxAmountIn - amountIn;
    if (_checkDeposit(c.marketIn, unspentCollateral)) {
      _transferFromAccount(c.borrower, assetIn, address(this), unspentCollateral);
      if (c.marketIn != EXA_USDC) {
        IERC20(c.marketIn.asset()).forceApprove(address(c.marketIn), unspentCollateral);
      }
      c.marketIn.deposit(unspentCollateral, c.borrower);
    }
  }

  function _swap(
    address account,
    IERC20 assetIn,
    IERC20 assetOut,
    uint256 maxAmountIn,
    uint256 minAmountOut,
    bytes memory route
  ) internal returns (uint256 amountIn, uint256 amountOut) {
    uint256 balanceIn = assetIn.balanceOf(account);
    uint256 balanceOut = assetOut.balanceOf(account);
    address _swapper = swapper;

    _approve(account, address(assetIn), _swapper, maxAmountIn);
    _execute(account, _swapper, 0, route);

    amountOut = assetOut.balanceOf(account) - balanceOut;
    if (minAmountOut > amountOut) revert Disagreement();

    _approve(account, address(assetIn), _swapper, 0);
    amountIn = balanceIn - assetIn.balanceOf(account);
  }

  function _approve(address account, address asset, address spender, uint256 amount) internal {
    _execute(account, asset, 0, abi.encodeCall(IERC20.approve, (spender, amount)));
  }

  function _execute(address account, address target, uint256 value, bytes memory data) internal {
    IPluginExecutor(account).executeFromPluginExternal(target, value, data);
  }

  function _transferFromAccount(address account, IERC20 asset, address receiver, uint256 amount) internal {
    _execute(account, address(asset), 0, abi.encodeCall(IERC20.transfer, (receiver, amount)));
  }

  function _checkDeposit(IMarket market, uint256 amount) internal view returns (bool) {
    return market.previewDeposit(amount) != 0 && !market.isFrozen();
  }
}

struct CrossRepayCallbackData {
  uint256 maturity;
  address borrower;
  uint256 positionAssets;
  uint256 maxRepay;
  IMarket marketIn;
  IMarket marketOut;
  uint256 maxAmountIn;
  bytes route;
}

struct RepayCallbackData {
  IMarket market;
  uint256 maturity;
  address borrower;
  uint256 positionAssets;
  uint256 maxRepay;
}
