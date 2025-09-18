// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { IFlashLoaner } from "./IExaAccount.sol";

contract FlashLoanAdapter is AccessControl, IFlashLoaner {
  IBalancerVaultV3 public immutable VAULT;

  mapping(IERC20 asset => IAToken aToken) public aTokens;

  constructor(IBalancerVaultV3 _vault, address owner) {
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
    VAULT = _vault;
  }

  function flashLoan(address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory data)
    external
    override
  {
    for (uint256 i; i < tokens.length; ++i) {
      if (tokens[i].balanceOf(address(VAULT)) < amounts[i]) {
        if (aTokens[tokens[i]].balanceOf(address(VAULT)) < amounts[i]) {
          revert InsufficientLiquidity();
        }
        tokens[i] = IERC20(aTokens[tokens[i]]);
      }
    }

    VAULT.unlock(abi.encodeWithSelector(this.receiveFlashLoan.selector, abi.encode(recipient, tokens, amounts, data)));
  }

  function receiveFlashLoan(bytes calldata payload) external {
    if (msg.sender != address(VAULT)) revert UnauthorizedVault();

    (address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory userData) =
      abi.decode(payload, (address, IERC20[], uint256[], bytes));

    for (uint256 i; i < tokens.length; ++i) {
      // TODO if it's an aToken, sendTo address(this), withdraw and send to recipient
      VAULT.sendTo(tokens[i], recipient, amounts[i]);
    }

    IFlashLoanRecipientV2(recipient).receiveFlashLoan(tokens, amounts, new uint256[](tokens.length), userData);

    for (uint256 i; i < tokens.length; ++i) {
      // TODO if it's an aToken, supply to the pool and transfer to the vault
      tokens[i].transfer(address(VAULT), amounts[i]);
      VAULT.settle(tokens[i], amounts[i]);
    }
  }

  function setAToken(IERC20 asset, IAToken token) external onlyRole(DEFAULT_ADMIN_ROLE) {
    aTokens[asset] = token;
    emit ATokenSet(asset, token, msg.sender);
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

interface IAToken is IERC20 {
  function burn(address from, address receiverOfUnderlying, uint256 amount, uint256 index) external;
  function mint(address caller, address onBehalfOf, uint256 amount, uint256 index) external returns (bool);
  // solhint-disable-next-line func-name-mixedcase
  function UNDERLYING_ASSET_ADDRESS() external view returns (address);
}

error InsufficientLiquidity();
error UnauthorizedVault();

event ATokenSet(IERC20 indexed asset, IAToken indexed aToken, address indexed account);
