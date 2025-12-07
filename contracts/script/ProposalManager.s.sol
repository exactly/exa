// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { LibString } from "solady/utils/LibString.sol";
import { Surl } from "surl/Surl.sol";

import { IAuditor, IDebtManager, IInstallmentsRouter, IMarket } from "../src/ExaPlugin.sol";
import { ProposalManager } from "../src/ProposalManager.sol";
import { JSON } from "./JSON.sol";

import { BaseScript, stdJson } from "./Base.s.sol";

contract DeployProposalManager is BaseScript {
  using LibString for uint256;
  using LibString for string;
  using stdJson for string;
  using JSON for string;
  using Surl for string;

  ProposalManager public proposalManager;

  address[] private allowlist;
  mapping(address asset => bool supported) private protocolAssets;

  function run() external {
    string memory deploy = vm.readFile("deploy.json");
    IAuditor auditor = IAuditor(protocol("Auditor"));
    IMarket[] memory markets = auditor.allMarkets();
    for (uint256 i = 0; i < markets.length; ++i) {
      address asset = markets[i].asset();
      allowlist.push(asset);
      protocolAssets[asset] = true;
      protocolAssets[address(markets[i])] = true;

      string memory symbol = markets[i].symbol();
      vm.label(address(markets[i]), symbol);
      vm.label(asset, symbol.slice(3));
    }
    allowlist.push(acct("swapper"));
    address esEXA = protocol("esEXA", false);
    if (esEXA != address(0)) allowlist.push(esEXA);
    address rewardsController = protocol("RewardsController", false);
    if (rewardsController != address(0)) allowlist.push(rewardsController);

    string memory chainAllowlist = string.concat(".proposalManager.allowlist.", block.chainid.toString());
    if (vm.keyExistsJson(deploy, chainAllowlist)) {
      string[] memory keys = vm.parseJsonKeys(deploy, chainAllowlist);
      for (uint256 i = 0; i < keys.length; ++i) {
        address asset = vm.parseAddress(keys[i]);
        if (asset == address(0) || protocolAssets[asset]) continue;
        allowlist.push(asset);

        vm.label(asset, deploy.readString(string.concat(chainAllowlist, ".", keys[i])));
      }
    }

    IDebtManager debtManager = IDebtManager(protocol("DebtRoller", false));
    if (address(debtManager) == address(0)) debtManager = IDebtManager(protocol("DebtManager"));

    vm.broadcast(acct("deployer"));
    proposalManager = new ProposalManager(
      acct("admin"),
      auditor,
      debtManager,
      IInstallmentsRouter(protocol("InstallmentsRouter")),
      acct("collector"),
      allowlist,
      deploy.readChainUint(".proposalManager.delay")
    );
  }
}
