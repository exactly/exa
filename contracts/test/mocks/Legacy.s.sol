// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IPlugin } from "modular-account-libs/interfaces/IPlugin.sol";

import { LibBytes } from "solady/utils/LibBytes.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";

import { BaseScript } from "../../script/Base.s.sol";
import { ExaAccountFactory } from "../../src/ExaAccountFactory.sol";
import { ProposalManager } from "../../src/ProposalManager.sol";

contract LegacyScript is BaseScript {
  using LibBytes for bytes;

  function run()
    external
    returns (IPlugin plugin, ExaAccountFactory factory, IPlugin v0Plugin, ExaAccountFactory v0Factory)
  {
    address admin = acct("admin");
    IPlugin ownerPlugin = IPlugin(dependency("webauthn-owner-plugin", "WebauthnOwnerPlugin", "Plugin", 0));
    bytes memory arguments = vm.parseJsonBytes(
        vm.readFile(string.concat("broadcast/ExaPlugin.s.sol/", vm.toString(block.chainid), "/run-latest.json")),
        ".transactions[0].transaction.input"
      )
      .slice(vm.getCode("ExaPlugin.sol:ExaPlugin").length);
    bytes memory v0Code = bytes.concat(
      initCode("@exactly/plugin@0.0.1:contracts/broadcast/Deploy.s.sol/10/run-latest.json", 9 * 32)
        .replace(hex"61012c", hex"610001"),
      abi.encode(
        protocol("Auditor"),
        protocol("MarketUSDC"),
        protocol("MarketWETH"),
        address(0),
        address(0),
        address(0),
        broadcast("IssuerChecker"),
        acct("collector"),
        address(0x420)
      )
    );

    vm.startBroadcast(admin);
    plugin = IPlugin(
      create3(
        admin,
        keccak256(abi.encode("ExaPlugin", "1.0.0", "legacy")),
        bytes.concat(
          initCode("@exactly/plugin@1.0.0:contracts/broadcast/ExaPlugin.s.sol/10/run-latest.json", arguments.length),
          arguments
        )
      )
    );
    factory = new ExaAccountFactory(admin, ownerPlugin, plugin, ACCOUNT_IMPL, ENTRYPOINT);
    ProposalManager(broadcast("ProposalManager")).grantRole(keccak256("PROPOSER_ROLE"), address(plugin));
    // solhint-disable-next-line no-inline-assembly
    assembly ("memory-safe") {
      v0Plugin := create(0, add(v0Code, 0x20), mload(v0Code))
    }
    v0Factory = new ExaAccountFactory(admin, ownerPlugin, v0Plugin, ACCOUNT_IMPL, ENTRYPOINT);
    vm.stopBroadcast();
  }

  function initCode(string memory path, uint256 argumentsLength) internal returns (bytes memory code) {
    string[] memory git = new string[](3);
    git[0] = "git";
    git[1] = "show";
    git[2] = path;
    code = vm.parseJsonBytes(string(vm.ffi(git)), ".transactions[0].transaction.input");
    code = code.slice(0, code.length - argumentsLength);
  }
}
