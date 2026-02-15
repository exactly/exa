// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { ExaAccountFactory } from "../../src/ExaAccountFactory.sol";
import { ExaPlugin } from "../../src/ExaPlugin.sol";
import { IExaAccount } from "../../src/IExaAccount.sol";

contract BobExecuteScript is BaseScript {
  using OwnersLib for address[];

  ExaPlugin public exaPlugin;
  ExaAccountFactory public factory;
  IExaAccount public bobAccount;

  function setUp() external {
    protocol("EXA");
    protocol("USDC");
    protocol("Auditor");
    protocol("MarketEXA");
    protocol("MarketUSDC");
    protocol("Balancer2Vault");
    broadcast("ProposalManager");

    skip(10 minutes);
    exaPlugin = ExaPlugin(payable(broadcast("ExaPlugin")));
    factory = ExaAccountFactory(
      payable(CREATE3_FACTORY.getDeployed(
          acct("admin"), keccak256(abi.encode(exaPlugin.pluginMetadata().name, exaPlugin.pluginMetadata().version))
        ))
    );
    address[] memory owners = new address[](1);
    owners[0] = vm.addr(0xb0b);
    bobAccount = IExaAccount(factory.getAddress(0, owners.toPublicKeys()));
    vm.label(address(exaPlugin), "ExaPlugin");
    vm.label(address(factory), "ExaAccountFactory");
    vm.label(address(bobAccount), "bobAccount");
    vm.label(address(ENTRYPOINT), "EntryPoint");
    vm.label(address(ACCOUNT_IMPL), "Account_Impl");
  }

  function run() external {
    vm.startBroadcast(acct("keeper"));

    bobAccount.executeProposal(0);
    bobAccount.executeProposal(1);
    bobAccount.executeProposal(2);
    bobAccount.executeProposal(3);

    new BatchDeploy(factory, 4);

    vm.stopBroadcast();
  }
}

contract BatchDeploy {
  using OwnersLib for address[];

  constructor(ExaAccountFactory factory, uint256 count) {
    address[] memory owners = new address[](1);
    for (uint256 i = 0; i < count; ++i) {
      owners[0] = address(uint160(420 + i));
      factory.createAccount(0, owners.toPublicKeys());
    }
  }
}
