// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ExaPreviewer, ICollectableMarket } from "../src/ExaPreviewer.sol";

import { BaseScript } from "./Base.s.sol";

contract DeployExaPreviewer is BaseScript {
  ExaPreviewer public previewer;

  function run() external {
    vm.broadcast(acct("deployer"));
    previewer = new ExaPreviewer(ICollectableMarket(protocol("MarketUSDC")));
  }
}
