// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { SafeERC20 } from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";

import { IAuditor, IMarket, NotMarket, Unauthorized } from "./IExaAccount.sol";

/// @title Depositor
/// @author Exactly
/// @notice Deposits the caller's assets at maturity for a receiver.
contract Depositor {
  using SafeERC20 for IERC20;

  IAuditor public immutable AUDITOR;

  constructor(IAuditor auditor) {
    AUDITOR = auditor;
  }

  function depositAtMaturity(
    IMarket market,
    uint256 maturity,
    uint256 assets,
    uint256 minAssetsRequired,
    address receiver
  ) external returns (uint256 positionAssets) {
    if (receiver == address(this)) revert Unauthorized();
    if (!AUDITOR.markets(market).isListed) revert NotMarket();
    IERC20 asset = IERC20(market.asset());
    asset.safeTransferFrom(msg.sender, address(this), assets);
    asset.forceApprove(address(market), assets);
    return market.depositAtMaturity(maturity, assets, minAssetsRequired, receiver);
  }
}
