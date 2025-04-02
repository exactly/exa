// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {
  ExaPlugin,
  IAuditor,
  IDebtManager,
  IFlashLoaner,
  IInstallmentsRouter,
  IMarket,
  IProposalManager,
  Parameters
} from "../src/ExaPlugin.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { BaseScript } from "./Base.s.sol";

contract DeployExaPlugin is BaseScript {
  ExaPlugin public exaPlugin;

  function run() external {
    vm.broadcast(acct("deployer"));
    exaPlugin = new ExaPlugin(
      Parameters({
        owner: acct("admin"),
        auditor: IAuditor(protocol("Auditor")),
        exaUSDC: IMarket(protocol("MarketUSDC")),
        exaWETH: IMarket(protocol("MarketWETH")),
        flashLoaner: IFlashLoaner(protocol("BalancerVault")),
        debtManager: IDebtManager(protocol("DebtManager")),
        installmentsRouter: IInstallmentsRouter(protocol("InstallmentsRouter")),
        issuerChecker: IssuerChecker(broadcast("IssuerChecker")),
        proposalManager: IProposalManager(broadcast("ProposalManager")),
        collector: acct("collector"),
        swapper: acct("swapper"),
        firstKeeper: acct("keeper")
      })
    );
  }
}
