// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { EntryPoint } from "account-abstraction/core/EntryPoint.sol"; // solhint-disable-line no-unused-import

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { LibString } from "solady/utils/LibString.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { VerifyingPaymaster } from "./VerifyingPaymaster.sol";

contract DeployAccount is BaseScript {
  using LibString for address;
  using LibString for bytes;

  function run() external {
    address deployer = acct("deployer");
    vm.setNonce(address(ENTRYPOINT), 1);
    deployCodeTo("EntryPoint.sol:EntryPoint", address(ENTRYPOINT));
    vm.startBroadcast(deployer);
    new WebauthnOwnerPlugin();
    vm.etch(ACCOUNT_IMPL, address(new UpgradeableModularAccount(ENTRYPOINT)).code);
    vm.label(address(ENTRYPOINT), "EntryPoint");
    vm.label(ACCOUNT_IMPL, "UpgradeableModularAccount");

    if (isAnvil()) {
      vm.deal(deployer, deployer.balance + 1 ether);
      ENTRYPOINT.depositTo{ value: 1 ether }(address(new VerifyingPaymaster(vm.addr(0x4337))));
      try vm.activeFork() {
        vm.rpc(
          "anvil_setCode",
          string.concat('["', address(ENTRYPOINT).toHexString(), '","', address(ENTRYPOINT).code.toHexString(), '"]') // solhint-disable-line quotes
        );
        address senderCreator = vm.computeCreateAddress(address(ENTRYPOINT), 1);
        vm.rpc(
          "anvil_setCode",
          string.concat('["', senderCreator.toHexString(), '","', senderCreator.code.toHexString(), '"]') // solhint-disable-line quotes
        );
        vm.rpc(
          "anvil_setCode",
          string.concat('["', ACCOUNT_IMPL.toHexString(), '","', ACCOUNT_IMPL.code.toHexString(), '"]') // solhint-disable-line quotes
        );
      } catch { } // solhint-disable-line no-empty-blocks
    }

    vm.stopBroadcast();
  }
}
