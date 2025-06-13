// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Ninja } from "../src/Ninja.sol";
import { BaseScript } from "./Base.s.sol";

contract DeployNinja is BaseScript {
  Ninja public ninja;

  function run() external {
    vm.startBroadcast();
    ninja = new Ninja();
  }
}
