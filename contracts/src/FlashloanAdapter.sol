// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { IERC4626 } from "openzeppelin-contracts/contracts/interfaces/IERC4626.sol";

import { IFlashLoaner } from "./IExaAccount.sol";

import { console } from "forge-std/console.sol";

contract FlashLoanAdapter is AccessControl, IFlashLoaner {
  IBalancerVaultV3 public immutable VAULT;

  mapping(IERC20 asset => bool isWAToken) public isWAToken;
  mapping(IERC20 asset => IWAToken wAToken) public wATokens;

  constructor(IBalancerVaultV3 _vault, address owner) {
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
    VAULT = _vault;
  }

  function flashLoan(address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory data)
    external
    override
  {
    for (uint256 i; i < tokens.length; ++i) {
      uint256 amount = amounts[i];
      if (tokens[i].balanceOf(address(VAULT)) < amount) {
        IWAToken wAToken = wATokens[tokens[i]];
        if (wAToken == IWAToken(address(0)) || wAToken.convertToAssets(wAToken.balanceOf(address(VAULT))) < amount) {
          revert InsufficientLiquidity();
        }
        tokens[i] = IERC20(wAToken);
        amounts[i] = wAToken.convertToShares(amount);
      }
    }

    VAULT.unlock(abi.encodeWithSelector(this.receiveFlashLoan.selector, abi.encode(recipient, tokens, amounts, data)));
  }

  function receiveFlashLoan(bytes calldata payload) external {
    if (msg.sender != address(VAULT)) revert UnauthorizedVault();

    (address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory userData) =
      abi.decode(payload, (address, IERC20[], uint256[], bytes));

    IERC20[] memory consumerTokens = new IERC20[](tokens.length);
    uint256[] memory consumerAmounts = new uint256[](tokens.length);

    for (uint256 i; i < tokens.length; ++i) {
      uint256 amount = amounts[i];
      IERC20 token = tokens[i];
      if (isWAToken[token]) {
        IWAToken wAToken = IWAToken(address(token));
        VAULT.sendTo(token, address(this), amount);
        wAToken.redeem(amount, recipient, address(this));
        consumerTokens[i] = IERC20(wAToken.asset());
        consumerAmounts[i] = wAToken.convertToAssets(amount);
      } else {
        consumerTokens[i] = token;
        consumerAmounts[i] = amount;
        VAULT.sendTo(token, recipient, amount);
      }
    }

    IFlashLoanRecipientV2(recipient).receiveFlashLoan(
      consumerTokens, consumerAmounts, new uint256[](tokens.length), userData
    );
    console.log("received flash loan");

    for (uint256 i; i < tokens.length; ++i) {
      IERC20 token = tokens[i];
      uint256 amount = amounts[i];

      if (isWAToken[token]) {
        IWAToken wAToken = IWAToken(address(token));
        console.log("depositing");
        console.log("token", address(token));
        console.log("amount", amount);
        IERC20(wAToken.asset()).approve(address(wAToken), type(uint256).max);
        // IERC20(wAToken.asset()).approve(address(VAULT), wAToken.convertToAssets(amount));
        wAToken.deposit(wAToken.convertToAssets(amount), address(VAULT));
        VAULT.settle(token, amount);
      } else {
        token.transfer(address(VAULT), amount);
        VAULT.settle(token, amount);
      }
    }
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

interface IFlashLoanRecipientV2 {
  function receiveFlashLoan(
    IERC20[] calldata tokens,
    uint256[] calldata amounts,
    uint256[] calldata feeAmounts,
    bytes calldata userData
  ) external;
}

interface IWAToken is IERC4626 {
  function aToken() external view returns (IAToken);
}

interface IAToken is IERC20 {
  function burn(address from, address receiverOfUnderlying, uint256 amount, uint256 index) external;
  function mint(address caller, address onBehalfOf, uint256 amount, uint256 index) external returns (bool);
  // solhint-disable-next-line func-name-mixedcase
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

error InsufficientLiquidity();
error UnauthorizedVault();

event WATokenSet(IERC20 indexed asset, IWAToken indexed wAToken, address indexed account);
