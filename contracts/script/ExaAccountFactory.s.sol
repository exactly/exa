// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IPlugin, PluginMetadata } from "modular-account-libs/interfaces/IPlugin.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";

import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import { ProposalManager } from "../src/ProposalManager.sol";
import { BaseScript } from "./Base.s.sol";

contract DeployExaAccountFactory is BaseScript {
  ExaAccountFactory public factory;

  function run() external {
    address admin = acct("admin");
    address exaPlugin = broadcast("ExaPlugin");
    address ownerPlugin = dependency("webauthn-owner-plugin", "WebauthnOwnerPlugin", "Plugin", 0);

    vm.startBroadcast(admin);

    factory = ExaAccountFactory(
      payable(
        CREATE3_FACTORY.deploy(
          _salt(IPlugin(exaPlugin)),
          abi.encodePacked(
            vm.getCode("ExaAccountFactory.sol:ExaAccountFactory"), // solhint-disable-line gas-small-strings
            abi.encode(admin, ownerPlugin, exaPlugin, ACCOUNT_IMPL, ENTRYPOINT)
          )
        )
      )
    );

    factory.addStake{ value: 0.1 ether }(1 days, 0.1 ether);

    ProposalManager(broadcast("ProposalManager")).grantRole(keccak256("PROPOSER_ROLE"), exaPlugin);

    vm.stopBroadcast();
  }

  function _salt(IPlugin plugin) internal pure returns (bytes32) {
    PluginMetadata memory metadata = plugin.pluginMetadata();
    return keccak256(abi.encode(metadata.name, metadata.version));
  }

  function getAddress() external returns (address) {
    etchCreate3();
    vm.etch(address(0), vm.getDeployedCode("ExaPlugin.sol:ExaPlugin"));
    return CREATE3_FACTORY.getDeployed(acct("admin"), _salt(IPlugin(address(0))));
  }
}
