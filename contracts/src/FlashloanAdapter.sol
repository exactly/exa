// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";

contract FlashLoanAdapter is AccessControl {
  IBalancerVaultV3 public immutable VAULT;

  mapping(IERC20 wAToken => bool isWAToken) public isWAToken;
  mapping(IERC20 asset => IWAToken wAToken) public wATokens;

  constructor(IBalancerVaultV3 _vault, address owner) {
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
    VAULT = _vault;
  }

  function flashLoan(address recipient, IERC20 token, uint256 amount, bytes memory data) external {
    uint256 debt = 0;
    if (token.balanceOf(address(VAULT)) < amount) {
      IWAToken wAToken = wATokens[token];
      if (wAToken == IWAToken(address(0)) || wAToken.convertToAssets(wAToken.balanceOf(address(VAULT))) < amount) {
        revert InsufficientLiquidity();
      }
      token = IERC20(address(wAToken));
      amount = wAToken.convertToShares(amount);
      debt = wAToken.previewMint(amount);
    } else {
      debt = amount;
    }
    VAULT.unlock(
      abi.encodeWithSelector(this.receiveFlashLoan.selector, abi.encode(recipient, token, amount, debt, data))
    );
  }

  function receiveFlashLoan(bytes calldata payload) external {
    if (msg.sender != address(VAULT)) revert UnauthorizedVault();
    (address recipient, IERC20 token, uint256 amount, uint256 debt, bytes memory data) =
      abi.decode(payload, (address, IERC20, uint256, uint256, bytes));

    if (isWAToken[token]) {
      IWAToken wAToken = IWAToken(address(token));
      VAULT.sendTo(token, address(this), amount);
      uint256 assets = wAToken.redeem(amount, recipient, address(this));
      IFlashLoanRecipient(recipient).receiveFlashLoan(IERC20(wAToken.asset()), assets, debt, data);
    } else {
      VAULT.sendTo(token, recipient, amount);
      IFlashLoanRecipient(recipient).receiveFlashLoan(token, amount, debt, data);
    }

    if (isWAToken[token]) {
      IWAToken wAToken = IWAToken(address(token));
      IERC20(wAToken.asset()).approve(address(wAToken), debt);
      wAToken.deposit(debt, address(VAULT));
    } else {
      token.transfer(address(VAULT), amount);
    }
    VAULT.settle(token, amount);
  }

  function setWAToken(IERC20 asset, IWAToken token) external onlyRole(DEFAULT_ADMIN_ROLE) {
    wATokens[asset] = token;
    isWAToken[token] = true;
    emit WATokenSet(asset, token, msg.sender);
  }
}

interface IBalancerVaultV3 {
  function sendTo(IERC20 token, address to, uint256 amount) external;
  function settle(IERC20 token, uint256 amountHint) external returns (uint256 credit);
  function unlock(bytes calldata data) external returns (bytes memory);
}

interface IFlashLoanRecipient {
  function receiveFlashLoan(IERC20 token, uint256 amount, uint256 debt, bytes calldata data) external;
}

interface IWAToken is IERC4626 {
  function aToken() external view returns (IERC20);
}

error InsufficientLiquidity();
error UnauthorizedVault();

event WATokenSet(IERC20 indexed asset, IWAToken indexed wAToken, address indexed account);
