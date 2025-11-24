// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { EntryPoint } from "account-abstraction/core/EntryPoint.sol";

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { LibString } from "solady/utils/LibString.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { MockPaymaster } from "./MockPaymaster.sol";

contract DeployAccount is BaseScript {
  using LibString for address;
  using LibString for bytes;

  address public paymaster;

  function run() external {
    address deployer = acct("deployer");
    vm.startBroadcast(deployer);
    vm.etch(address(ENTRYPOINT), address(new EntryPoint()).code);
    vm.etch(ACCOUNT_IMPL, address(new UpgradeableModularAccount(ENTRYPOINT)).code);
    vm.label(address(ENTRYPOINT), "EntryPoint");
    vm.label(ACCOUNT_IMPL, "UpgradeableModularAccount");

    if (block.chainid == getChain("anvil").chainId) {
      paymaster = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
      bytes memory paymasterCode = address(new MockPaymaster()).code;
      vm.etch(paymaster, paymasterCode);
      vm.label(paymaster, "MockPaymaster");
      vm.deal(deployer, deployer.balance + 1 ether);
      ENTRYPOINT.depositTo{ value: 1 ether }(paymaster);
      try vm.activeFork() {
        vm.rpc(
          "anvil_setCode",
          string.concat('["', address(ENTRYPOINT).toHexString(), '","', address(ENTRYPOINT).code.toHexString(), '"]') // solhint-disable-line quotes
        );
        vm.rpc(
          "anvil_setCode",
          string.concat('["', ACCOUNT_IMPL.toHexString(), '","', ACCOUNT_IMPL.code.toHexString(), '"]') // solhint-disable-line quotes
        );
        vm.rpc("anvil_setCode", string.concat('["', paymaster.toHexString(), '","', paymasterCode.toHexString(), '"]')); // solhint-disable-line quotes
      } catch { } // solhint-disable-line no-empty-blocks
    }

    vm.stopBroadcast();
  }
}
