// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { Script } from "forge-std/Script.sol";

contract FundPoker is Script {
  address payable internal constant POKER = payable(0xafD89CAC1C162bbF6DBFAF0390d159Cf9a01424C);

  function run() external {
    vm.createSelectFork("optimism_sepolia");
    vm.broadcast();
    POKER.transfer(0.1 ether);
  }
}
