// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Liquidator } from "../src/Liquidator.sol";

import { BaseScript } from "./Base.s.sol";

contract DeployLiquidator is BaseScript {
  Liquidator public liquidator;

  function run() external {
    address deployer = acct("deployer");
    vm.startBroadcast(deployer);

    liquidator = new Liquidator(
      deployer, protocol("Auditor"), acct("Uniswap3Factory"), acct("Uniswap3Router02"), protocol("VelodromePoolFactory")
    );

    liquidator.grantRoles(acct("liquidator"), 1);

    liquidator.transferOwnership(acct("liquidatorAdmin"));

    vm.stopBroadcast();
  }

  function getCode() external returns (bytes memory code) {
    return address(
      new Liquidator(
        acct("deployer"),
        protocol("Auditor"),
        acct("Uniswap3Factory"),
        acct("Uniswap3Router02"),
        protocol("VelodromePoolFactory")
      )
    ).code;
  }
}
