// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { IFlashLoaner } from "./IExaAccount.sol";

contract FlashLoanAdapter is AccessControl, IFlashLoaner {
  IBalancerVaultV3 public immutable VAULT;

  mapping(IERC20 asset => IAavePool pool) public pools;

  constructor(IBalancerVaultV3 _vault, address owner) {
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
    VAULT = _vault;
  }

  function flashLoan(address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory data)
    external
    override
  {
    VAULT.unlock(abi.encodeWithSelector(this.receiveFlashLoan.selector, abi.encode(recipient, tokens, amounts, data)));
  }

  function receiveFlashLoan(bytes calldata payload) external {
    if (msg.sender != address(VAULT)) revert UnauthorizedVault();

    (address recipient, IERC20[] memory tokens, uint256[] memory amounts, bytes memory userData) =
      abi.decode(payload, (address, IERC20[], uint256[], bytes));

    for (uint256 i; i < tokens.length; ++i) {
      VAULT.sendTo(tokens[i], recipient, amounts[i]);
    }

    IFlashLoanRecipientV2(recipient).receiveFlashLoan(tokens, amounts, new uint256[](tokens.length), userData);

    for (uint256 i; i < tokens.length; ++i) {
      tokens[i].transfer(address(VAULT), amounts[i]);
      VAULT.settle(tokens[i], amounts[i]);
    }
  }

  function setPool(IERC20 asset, IAavePool pool) external onlyRole(DEFAULT_ADMIN_ROLE) {
    pools[asset] = pool;
    emit PoolSet(asset, pool, msg.sender);
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

interface IAavePool {
  // TODO check supply on behalf of the vault
  function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external;
  function withdraw(address asset, uint256 amount, address to) external;
}

error UnauthorizedVault();

event PoolSet(IERC20 indexed asset, IAavePool indexed pool, address indexed account);
