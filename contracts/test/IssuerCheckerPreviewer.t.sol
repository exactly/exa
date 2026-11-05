// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Expired, Replay, Timelocked } from "../src/IExaAccount.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { IssuerCheckerPreviewer } from "../src/IssuerCheckerPreviewer.sol";
import { ForkTest } from "./Fork.t.sol";

contract IssuerCheckerPreviewerTest is ForkTest {
  IssuerChecker internal issuerChecker;
  bytes internal code;
  address internal account = address(0x420);

  function setUp() external {
    vm.warp(1 days);
    issuerChecker = new IssuerChecker(address(this), address(this), 10 minutes, 10 days);
    code = address(issuerChecker).code;
    vm.etch(address(issuerChecker), address(new IssuerCheckerPreviewer()).code);
  }

  // solhint-disable func-name-mixedcase

  function test_checkIssuer_collects_withoutSignature() external {
    uint256 timestamp = block.timestamp - 10 minutes;
    issuerChecker.checkIssuer(account, 1e6, timestamp, "");

    vm.etch(address(issuerChecker), code);
    assertTrue(issuerChecker.collections(account, keccak256(abi.encode(1e6, timestamp))));
  }

  function test_checkIssuer_reverts_whenReplayed() external {
    issuerChecker.checkIssuer(account, 1e6, block.timestamp, "");

    vm.expectRevert(Replay.selector);
    issuerChecker.checkIssuer(account, 1e6, block.timestamp, "");
  }

  function test_checkIssuer_reverts_whenExpired() external {
    vm.expectRevert(Expired.selector);
    issuerChecker.checkIssuer(account, 1e6, block.timestamp - 10 minutes - 1, "");
  }

  function test_checkIssuer_reverts_whenTimelocked() external {
    vm.expectRevert(Timelocked.selector);
    issuerChecker.checkIssuer(account, 1e6, block.timestamp + 1 minutes + 1, "");
  }
}
