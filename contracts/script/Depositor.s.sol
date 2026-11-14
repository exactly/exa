// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Depositor, IAuditor } from "../src/Depositor.sol";

import { BaseScript } from "./Base.s.sol";

contract DeployDepositor is BaseScript {
  Depositor public depositor;

  function run() external {
    vm.broadcast(acct("deployer"));
    depositor = new Depositor(IAuditor(protocol("Auditor")));
  }
}
