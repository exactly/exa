// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { TimelockController } from "@openzeppelin/contracts-v4/governance/TimelockController.sol";
import { ProxyAdmin } from "@openzeppelin/contracts-v4/proxy/transparent/ProxyAdmin.sol";
import {
  ITransparentUpgradeableProxy,
  TransparentUpgradeableProxy
} from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";

import { BaseScript } from "./Base.s.sol";

contract SerialProxier is BaseScript {
  error TargetNonceTooLow();

  Dummy public dummy;

  /// @notice Deploys proxies with dummy implementation, consuming deployer nonces
  /// @param targetNonce The nonce to stop at (exclusive)
  /// @return start The starting nonce
  function run(uint256 targetNonce) external returns (uint256 start) {
    address admin = acct("admin");
    address deployer = acct("deployer");
    address proxyAdmin = protocol("ProxyAdmin");

    start = vm.getNonce(deployer);
    if (targetNonce <= start) revert TargetNonceTooLow();

    if (address(dummy) == address(0)) dummy = new Dummy();

    vm.startBroadcast(deployer);
    for (uint256 nonce = vm.getNonce(deployer); nonce < targetNonce; ++nonce) {
      address proxy =
        address(new TransparentUpgradeableProxy(address(dummy), proxyAdmin, abi.encodeCall(Dummy.initialize, (admin))));
      vm.label(proxy, string.concat("Proxy", vm.toString(nonce)));
    }

    vm.stopBroadcast();
  }

  function proposeUpgrade(address proxy, address implementation, bytes memory initData) external {
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    address proxyAdmin = protocol("ProxyAdmin");

    bytes[] memory payloads = new bytes[](1);
    payloads[0] =
      abi.encodeCall(ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), implementation, initData));
    address[] memory targets = new address[](payloads.length);
    targets[0] = proxyAdmin;
    uint256[] memory values = new uint256[](payloads.length);
    bytes32 salt = "";

    vm.startBroadcast(acct("exactly"));
    timelock.scheduleBatch(targets, values, payloads, 0, salt, timelock.getMinDelay());
    vm.stopBroadcast();
  }

  function executeUpgrade(address proxy, address implementation, bytes memory initData) external {
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    address proxyAdmin = protocol("ProxyAdmin");

    bytes[] memory payloads = new bytes[](1);
    payloads[0] =
      abi.encodeCall(ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), implementation, initData));
    address[] memory targets = new address[](payloads.length);
    targets[0] = proxyAdmin;
    uint256[] memory values = new uint256[](payloads.length);
    bytes32 salt = "";

    vm.startBroadcast(acct("exactly"));
    timelock.executeBatch(targets, values, payloads, 0, salt);
    vm.stopBroadcast();
  }

  function proposeUpgradeWithReset(address proxy, address implementation, bytes memory initData, address resetter)
    external
  {
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    address proxyAdmin = protocol("ProxyAdmin");

    bytes[] memory payloads = new bytes[](2);
    payloads[0] = abi.encodeCall(
      ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), resetter, abi.encodeCall(Resetter.reset, ()))
    );
    payloads[1] =
      abi.encodeCall(ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), implementation, initData));
    address[] memory targets = new address[](payloads.length);
    targets[0] = proxyAdmin;
    targets[1] = proxyAdmin;
    uint256[] memory values = new uint256[](payloads.length);
    bytes32 salt = "";

    vm.startBroadcast(acct("exactly"));
    timelock.scheduleBatch(targets, values, payloads, 0, salt, timelock.getMinDelay());
    vm.stopBroadcast();
  }

  function executeUpgradeWithReset(address proxy, address implementation, bytes memory initData, address resetter)
    external
  {
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    address proxyAdmin = protocol("ProxyAdmin");

    bytes[] memory payloads = new bytes[](2);
    payloads[0] = abi.encodeCall(
      ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), resetter, abi.encodeCall(Resetter.reset, ()))
    );
    payloads[1] =
      abi.encodeCall(ProxyAdmin.upgradeAndCall, (ITransparentUpgradeableProxy(proxy), implementation, initData));
    address[] memory targets = new address[](payloads.length);
    targets[0] = proxyAdmin;
    targets[1] = proxyAdmin;
    uint256[] memory values = new uint256[](payloads.length);
    bytes32 salt = "";

    vm.startBroadcast(acct("exactly"));
    timelock.executeBatch(targets, values, payloads, 0, salt);
    vm.stopBroadcast();
  }
}

/// @dev Dummy implementation for proxies, with initializable owner matching OZ v5 Ownable storage layout
contract Dummy is Ownable(address(1)) {
  error AlreadyInitialized();

  function initialize(address owner_) external {
    if (owner() != address(0)) revert AlreadyInitialized();
    _transferOwnership(owner_);
  }
}

contract Resetter {
  address public owner;

  function reset() external {
    owner = address(0);
  }
}
