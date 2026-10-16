// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { IPriceFeed } from "../../src/IExaAccount.sol";
import { Price } from "../../src/PricePreviewer.sol";

contract MockPriceFeed is IPriceFeed {
  uint16 public phaseId;
  uint256 public hidden;
  mapping(uint256 phase => bool strict) public strict;
  mapping(uint256 phase => Price[] reports) internal reports;
  uint8 internal immutable DECIMALS;

  constructor(uint8 decimals_) {
    DECIMALS = decimals_;
  }

  function push(uint16 phase, uint256 timestamp, int256 answer) external {
    if (phase > phaseId) phaseId = phase;
    reports[phase].push(Price(timestamp, answer));
  }

  function setHidden(uint256 hidden_) external {
    hidden = hidden_;
  }

  function setStrict(uint256 phase) external {
    strict[phase] = true;
  }

  function decimals() external view returns (uint8) {
    return DECIMALS;
  }

  function getRoundData(uint80 roundId) public view returns (uint80, int256, uint256, uint256, uint80) {
    Price[] storage history = reports[roundId >> 64];
    uint256 round = uint64(roundId);
    if (round == 0 || round > history.length) {
      if (strict[roundId >> 64]) revert NoData();
      return (roundId, 0, 0, 0, roundId);
    }
    Price storage report = history[round - 1];
    return (roundId, report.answer, report.timestamp, report.timestamp, roundId);
  }

  function latestAnswer() external view returns (int256 answer) {
    (, answer,,,) = latestRoundData();
  }

  function latestRoundData() public view returns (uint80, int256, uint256, uint256, uint80) {
    return getRoundData(uint80(phaseId) << 64 | uint80(reports[phaseId].length - hidden));
  }

  function visible(uint256 phase) external view returns (Price[] memory history) {
    history = reports[phase];
    if (phase == phaseId) {
      Price[] memory trimmed = new Price[](history.length - hidden);
      for (uint256 i = 0; i < trimmed.length; ++i) {
        trimmed[i] = history[i];
      }
      history = trimmed;
    }
  }
}

error NoData();
