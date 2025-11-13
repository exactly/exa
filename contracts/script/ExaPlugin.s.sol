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
    IDebtManager debtManager = IDebtManager(protocol("DebtRoller", false));
    IFlashLoaner flashLoaner = IFlashLoaner(protocol("FlashLoanAdapter", false));
    if (address(debtManager) == address(0)) debtManager = IDebtManager(protocol("DebtManager"));
    if (address(flashLoaner) == address(0)) flashLoaner = IFlashLoaner(protocol("Balancer2Vault"));

    vm.broadcast(acct("deployer"));
    exaPlugin = new ExaPlugin(
      Parameters({
        owner: acct("admin"),
        auditor: IAuditor(protocol("Auditor")),
        exaUSDC: IMarket(protocol("MarketUSDC")),
        exaWETH: IMarket(protocol("MarketWETH")),
        flashLoaner: flashLoaner,
        debtManager: debtManager,
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
