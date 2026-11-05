// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Expired, Replay, Timelocked } from "../src/IExaAccount.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { IssuerCheckerPreviewer } from "../src/IssuerCheckerPreviewer.sol";
import { ForkTest } from "./Fork.t.sol";

contract IssuerCheckerPreviewerTest is ForkTest {
  IssuerChecker internal issuerChecker;
  bytes internal code;

  function setUp() external {
    vm.warp(1 days);
    issuerChecker = new IssuerChecker(address(this), address(this), 10 minutes, 10 days);
    code = address(issuerChecker).code;
    vm.etch(address(issuerChecker), address(new IssuerCheckerPreviewer()).code);
  }

  // solhint-disable func-name-mixedcase

  function test_checkIssuer_collects_withoutSignature(address account, uint256 amount, uint256 timestamp) external {
    timestamp = bound(timestamp, block.timestamp - 10 minutes, block.timestamp + 1 minutes);
    issuerChecker.checkIssuer(account, amount, timestamp, "");

    vm.etch(address(issuerChecker), code);
    assertTrue(issuerChecker.collections(account, keccak256(abi.encode(amount, timestamp))));
  }

  function test_checkIssuer_collects_whenOtherAccountOrAmountCollected(
    address account,
    address other,
    uint256 amount,
    uint256 otherAmount,
    uint256 timestamp
  ) external {
    vm.assume(account != other && amount != otherAmount);
    timestamp = bound(timestamp, block.timestamp - 10 minutes, block.timestamp + 1 minutes);
    issuerChecker.checkIssuer(account, amount, timestamp, "");
    issuerChecker.checkIssuer(other, amount, timestamp, "");
    issuerChecker.checkIssuer(account, otherAmount, timestamp, "");
  }

  function test_checkIssuer_reverts_whenReplayed(address account, uint256 amount, uint256 timestamp) external {
    timestamp = bound(timestamp, block.timestamp - 10 minutes, block.timestamp + 1 minutes);
    issuerChecker.checkIssuer(account, amount, timestamp, "");

    vm.expectRevert(Replay.selector);
    issuerChecker.checkIssuer(account, amount, timestamp, "");
  }

  function test_checkIssuer_reverts_whenExpired(address account, uint256 amount, uint256 timestamp) external {
    timestamp = bound(timestamp, 0, block.timestamp - 10 minutes - 1);
    vm.expectRevert(Expired.selector);
    issuerChecker.checkIssuer(account, amount, timestamp, "");
  }

  function test_checkIssuer_reverts_whenTimelocked(address account, uint256 amount, uint256 timestamp) external {
    timestamp = bound(timestamp, block.timestamp + 1 minutes + 1, type(uint256).max);
    vm.expectRevert(Timelocked.selector);
    issuerChecker.checkIssuer(account, amount, timestamp, "");
  }
}
