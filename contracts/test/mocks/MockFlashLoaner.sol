// SPDX-License-Identifier: BUSL-1.1
pragma solidity ^0.8.0;

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { ReentrancyGuard } from "solady/utils/ReentrancyGuard.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

contract MockFlashLoaner is ReentrancyGuard {
  using SafeTransferLib for address;

  uint256 internal fee;

  constructor(uint256 fee_) {
    fee = fee_;
  }

  function flashLoan(
    IFlashLoanRecipient recipient,
    IERC20[] memory tokens,
    uint256[] memory amounts,
    bytes memory userData
  ) external nonReentrant {
    assert(tokens.length == amounts.length);

    uint256[] memory preLoanBalances = new uint256[](tokens.length);

    // Used to ensure `tokens` is sorted in ascending order, which ensures token uniqueness.
    IERC20 previousToken = IERC20(address(0));

    for (uint256 i = 0; i < tokens.length; ++i) {
      IERC20 token = tokens[i];
      uint256 amount = amounts[i];

      // solhint-disable-next-line gas-custom-errors
      require(token > previousToken, token == IERC20(address(0)) ? "Zero token" : "Unsorted tokens");
      previousToken = token;

      preLoanBalances[i] = token.balanceOf(address(this));

      require(preLoanBalances[i] >= amount, "insufficient flashloan balance"); // solhint-disable-line gas-custom-errors
      address(token).safeTransfer(address(recipient), amount);
    }

    uint256[] memory fees = new uint256[](tokens.length);
    for (uint256 i = 0; i < fees.length; ++i) {
      fees[i] = fee;
    }

    recipient.receiveFlashLoan(tokens, amounts, fees, userData);

    for (uint256 i = 0; i < tokens.length; ++i) {
      uint256 postLoanBalance = tokens[i].balanceOf(address(this));
      require(postLoanBalance >= preLoanBalances[i] + fees[i], "invalid post balance"); // solhint-disable-line gas-custom-errors
    }
  }
}

interface IFlashLoanRecipient {
  function receiveFlashLoan(
    IERC20[] memory tokens,
    uint256[] memory amounts,
    uint256[] memory feeAmounts,
    bytes memory userData
  ) external;
}
