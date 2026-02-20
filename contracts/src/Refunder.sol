// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { AccessControl } from "openzeppelin-contracts/contracts/access/AccessControl.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import { IMarket, Unauthorized } from "./IExaAccount.sol";
import { IssuerChecker } from "./IssuerChecker.sol";

/// @title Refunder
/// @author Exactly
contract Refunder is AccessControl {
  using SafeERC20 for IERC20;

  IMarket public immutable EXA_USDC;
  IssuerChecker public immutable ISSUER_CHECKER;
  bytes32 public constant KEEPER_ROLE = keccak256("KEEPER_ROLE");

  constructor(address owner, IMarket exaUSDC, IssuerChecker issuerChecker, address firstKeeper) {
    EXA_USDC = exaUSDC;
    IERC20(EXA_USDC.asset()).forceApprove(address(EXA_USDC), type(uint256).max);
    ISSUER_CHECKER = issuerChecker;
    _grantRole(KEEPER_ROLE, firstKeeper);
    _grantRole(DEFAULT_ADMIN_ROLE, owner);
  }

  function refund(address account, uint256 amount, uint256 timestamp, bytes calldata signature)
    external
    onlyKeeper
    onlyIssuer(account, amount, timestamp, signature)
  {
    EXA_USDC.deposit(amount, account);
  }

  function withdraw(address asset, address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
    IERC20(asset).safeTransfer(to, amount);
  }

  /// forge-lint: disable-next-item(unwrapped-modifier-logic)
  modifier onlyKeeper() {
    if (!hasRole(KEEPER_ROLE, msg.sender)) revert Unauthorized();
    _;
  }

  /// forge-lint: disable-next-item(unwrapped-modifier-logic)
  modifier onlyIssuer(address account, uint256 amount, uint256 timestamp, bytes calldata signature) {
    ISSUER_CHECKER.check(account, amount, timestamp, true, signature);
    _;
  }
}
