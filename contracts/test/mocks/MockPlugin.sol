// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.0;

import { BasePlugin, PluginManifest } from "modular-account-libs/plugins/BasePlugin.sol";

contract MockPlugin is BasePlugin {
  function onInstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  function onUninstall(bytes calldata) external override { } // solhint-disable-line no-empty-blocks

  // solhint-disable-next-line no-empty-blocks
  function pluginManifest() external pure override returns (PluginManifest memory manifest) { }
}
