// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Firewall } from "@exactly/protocol/verified/Firewall.sol";

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { TimelockController } from "openzeppelin-contracts/contracts/governance/TimelockController.sol";

import { BaseScript } from "./Base.s.sol";

contract GrantAllower is BaseScript {
  function run() external {
    vm.createSelectFork("base_sepolia");
    Firewall firewall = Firewall(protocol("Firewall"));
    IAccessControl plugin = IAccessControl(broadcast("ExaPlugin"));
    IAccessControl refund = IAccessControl(broadcast("Refunder"));
    address allower = acct("allower");
    address poker = acct("poker");
    address refunder = acct("refunder");

    vm.startBroadcast(acct("deployer"));
    if (!firewall.hasRole(keccak256("ALLOWER_ROLE"), allower)) {
      TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
      bytes memory call = abi.encodeCall(IAccessControl.grantRole, (keccak256("ALLOWER_ROLE"), allower));
      timelock.schedule(address(firewall), 0, call, bytes32(0), bytes32(0), timelock.getMinDelay());
      timelock.execute(address(firewall), 0, call, bytes32(0), bytes32(0));
    }
    if (!plugin.hasRole(keccak256("KEEPER_ROLE"), poker)) plugin.grantRole(keccak256("KEEPER_ROLE"), poker);
    if (!refund.hasRole(keccak256("KEEPER_ROLE"), refunder)) refund.grantRole(keccak256("KEEPER_ROLE"), refunder);
    if (allower.balance < 0.1 ether) payable(allower).transfer(0.1 ether - allower.balance);
    if (poker.balance < 0.1 ether) payable(poker).transfer(0.1 ether - poker.balance);
    if (refunder.balance < 0.1 ether) payable(refunder).transfer(0.1 ether - refunder.balance);
    vm.stopBroadcast();
  }
}
