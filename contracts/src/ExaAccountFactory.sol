// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IAccountInitializable } from "modular-account/src/interfaces/IAccountInitializable.sol";
import { IEntryPoint } from "modular-account/src/interfaces/erc4337/IEntryPoint.sol";

import { IPlugin } from "modular-account-libs/interfaces/IPlugin.sol";

import { PublicKey } from "webauthn-owner-plugin/IWebauthnOwnerPlugin.sol";
import { OwnersLib } from "webauthn-owner-plugin/OwnersLib.sol";
import { WebauthnModularAccountFactory } from "webauthn-owner-plugin/WebauthnModularAccountFactory.sol";

contract ExaAccountFactory is WebauthnModularAccountFactory {
  using OwnersLib for PublicKey;

  IPlugin public immutable EXA_PLUGIN;
  bytes32 internal immutable _EXA_PLUGIN_MANIFEST_HASH;

  constructor(
    address owner,
    IPlugin webauthnOwnerPlugin,
    IPlugin exaPlugin,
    address implementation,
    IEntryPoint entryPoint
  )
    WebauthnModularAccountFactory(
      owner,
      address(webauthnOwnerPlugin),
      implementation,
      keccak256(abi.encode(webauthnOwnerPlugin.pluginManifest())),
      entryPoint
    )
  {
    EXA_PLUGIN = exaPlugin;
    _EXA_PLUGIN_MANIFEST_HASH = keccak256(abi.encode(exaPlugin.pluginManifest()));
  }

  function createAccount(address source, PublicKey[] calldata owners) external returns (address) {
    return this.createAccount(uint256(uint160(source)), owners);
  }

  function getAddress(address source, PublicKey[] calldata owners) external view returns (address) {
    return this.getAddress(uint256(uint160(source)), owners);
  }

  function donateStake() external payable {
    ENTRYPOINT.addStake{ value: msg.value }(1 days);
  }

  function _initializeAccount(IAccountInitializable account, uint256 salt, bytes memory owners) internal override {
    address[] memory plugins = new address[](2);
    plugins[0] = WEBAUTHN_OWNER_PLUGIN;
    plugins[1] = address(EXA_PLUGIN);

    bytes32[] memory manifestHashes = new bytes32[](2);
    manifestHashes[0] = _WEBAUTHN_OWNER_PLUGIN_MANIFEST_HASH;
    manifestHashes[1] = _EXA_PLUGIN_MANIFEST_HASH;

    bytes[] memory initBytes = new bytes[](2);
    initBytes[0] = owners;
    // forge-lint: disable-next-line(unsafe-typecast) -- salt fits in address by construction in createAccount
    if (salt != 0) initBytes[1] = abi.encode(address(uint160(salt)));

    emit ExaAccountInitialized(address(account));

    account.initialize(plugins, abi.encode(manifestHashes, initBytes));
  }
}

event ExaAccountInitialized(address indexed account);
