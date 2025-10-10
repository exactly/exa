// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.20;

import { IFlashLoanRecipient } from "./FlashloanAdapter.sol";
import { FixedPosition, IAuditor, IFlashLoaner, IMarket, NotMarket } from "./IExaAccount.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { FixedPointMathLib } from "solady/utils/FixedPointMathLib.sol";
import { SafeTransferLib } from "solady/utils/SafeTransferLib.sol";

contract DebtRoller is IFlashLoanRecipient {
  using FixedPointMathLib for uint256;
  using SafeTransferLib for address;

  IAuditor public immutable AUDITOR;
  IFlashLoaner public flashLoaner;
  bytes32 private callHash;

  constructor(IAuditor auditor, IFlashLoaner flashLoaner_) {
    AUDITOR = auditor;
    flashLoaner = flashLoaner_;

    IMarket[] memory markets = auditor.allMarkets();
    for (uint256 i = 0; i < markets.length; ++i) {
      approve(markets[i]);
    }
  }

  function rollFixed(
    IMarket market,
    uint256 repayMaturity,
    uint256 borrowMaturity,
    uint256 maxRepayAssets,
    uint256 maxBorrowAssets,
    uint256 percentage
  ) external {
    _checkMarket(market);

    RollFixedData memory data = RollFixedData({
      sender: msg.sender,
      market: market,
      repayMaturity: repayMaturity,
      borrowMaturity: borrowMaturity,
      maxRepayAssets: maxRepayAssets,
      maxBorrowAssets: maxBorrowAssets,
      percentage: percentage
    });

    IERC20[] memory tokens = new IERC20[](1);
    tokens[0] = IERC20(market.asset());
    uint256[] memory amounts = new uint256[](1);
    amounts[0] = maxRepayAssets;

    flashLoaner.flashLoan(address(this), tokens, amounts, _hash(abi.encode(data)));
  }

  function approve(IMarket market) public {
    _checkMarket(market);
    market.asset().safeApprove(address(market), type(uint256).max);
  }

  function _hash(bytes memory data) internal returns (bytes memory) {
    callHash = keccak256(data);
    return data;
  }

  function receiveFlashLoan(IERC20[] memory, uint256[] memory, uint256[] memory fees, bytes memory data) external {
    bytes32 memCallHash = callHash;
    assert(msg.sender == address(flashLoaner) && memCallHash == keccak256(data));
    callHash = bytes32(0);

    RollFixedData memory r = abi.decode(data, (RollFixedData));
    FixedPosition memory position = r.market.fixedBorrowPositions(r.repayMaturity, r.sender);
    uint256 positionAssets =
      r.percentage < 1e18 ? r.percentage.mulWad(position.principal + position.fee) : position.principal + position.fee;

    uint256 actualRepay = r.market.repayAtMaturity(r.repayMaturity, positionAssets, r.maxRepayAssets, r.sender);
    uint256 cost = actualRepay + fees[0];
    r.market.borrowAtMaturity(r.borrowMaturity, cost, r.maxBorrowAssets, address(this), r.sender);

    r.market.asset().safeTransfer(address(flashLoaner), r.maxRepayAssets + fees[0]);
  }

  function _checkMarket(IMarket market) internal view {
    if (!AUDITOR.markets(market).isListed) revert NotMarket();
  }
}

struct RollFixedData {
  address sender;
  IMarket market;
  uint256 repayMaturity;
  uint256 borrowMaturity;
  uint256 maxRepayAssets;
  uint256 maxBorrowAssets;
  uint256 percentage;
}
