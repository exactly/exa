// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IAccountInitializable } from "modular-account/src/interfaces/IAccountInitializable.sol";
import { IEntryPoint } from "modular-account/src/interfaces/erc4337/IEntryPoint.sol";

import { IPlugin } from "modular-account-libs/interfaces/IPlugin.sol";

import { WebauthnModularAccountFactory } from "webauthn-owner-plugin/WebauthnModularAccountFactory.sol";

contract LegacyExaAccountFactory is WebauthnModularAccountFactory {
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

  function _initializeAccount(IAccountInitializable account, bytes memory owners) internal override {
    address[] memory plugins = new address[](2);
    plugins[0] = WEBAUTHN_OWNER_PLUGIN;
    plugins[1] = address(EXA_PLUGIN);

    bytes32[] memory manifestHashes = new bytes32[](2);
    manifestHashes[0] = _WEBAUTHN_OWNER_PLUGIN_MANIFEST_HASH;
    manifestHashes[1] = _EXA_PLUGIN_MANIFEST_HASH;

    bytes[] memory initBytes = new bytes[](2);
    initBytes[0] = owners;

    account.initialize(plugins, abi.encode(manifestHashes, initBytes));
  }
}
