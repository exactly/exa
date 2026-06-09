// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {
  TransparentUpgradeableProxy
} from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { TimelockController } from "openzeppelin-contracts/contracts/governance/TimelockController.sol";

import { PausableHook } from "@hyperlane-xyz/core/contracts/hooks/PausableHook.sol";
import { StaticAggregationHook } from "@hyperlane-xyz/core/contracts/hooks/aggregation/StaticAggregationHook.sol";
import { IMailbox } from "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import { PausableIsm } from "@hyperlane-xyz/core/contracts/isms/PausableIsm.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import { BaseScript } from "./Base.s.sol";

/// @title HypEXA
/// @notice Deploys and maintains the Hyperlane HypXERC20 router for EXA.
contract HypEXA is BaseScript {
  function deployRouter(address token, uint32[] calldata remoteDomains) external returns (HypXERC20 router) {
    address admin = acct("admin");
    router = HypXERC20(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXA"))));
    if (address(router).code.length != 0) return router;
    vm.startBroadcast(admin);

    (address hook, address ism) = _deployAggregations(
      _deployPausableHook(acct("exactly")),
      _deployPausableHook(acct("pauser")),
      _deployPausableIsm(acct("exactly")),
      _deployPausableIsm(acct("pauser"))
    );

    router = HypXERC20(
      CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXA")),
        abi.encodePacked(
          type(TransparentUpgradeableProxy).creationCode,
          abi.encode(
            address(new HypXERC20(token, 1, 1, acct("hyperlaneMailbox"))),
            protocol("ProxyAdmin"),
            abi.encodeCall(HypERC20Collateral.initialize, (hook, ism, admin))
          )
        )
      )
    );

    if (remoteDomains.length > 0) {
      bytes32[] memory addresses = new bytes32[](remoteDomains.length);
      bytes32 remote = bytes32(uint256(uint160(address(router))));
      for (uint256 i = 0; i < remoteDomains.length; ++i) {
        addresses[i] = remote;
      }
      router.enrollRemoteRouters(remoteDomains, addresses);
    }

    router.transferOwnership(acct("exactly"));
    vm.stopBroadcast();
  }

  function proposeBridgeRole(address token, bytes32 salt) external {
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    if (IAccessControl(token).hasRole(keccak256("BRIDGE_ROLE"), router)) revert AlreadyGranted();
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    uint256 delay = timelock.getMinDelay();
    vm.broadcast(acct("deployer"));
    timelock.schedule(
      token, 0, abi.encodeCall(IAccessControl.grantRole, (keccak256("BRIDGE_ROLE"), router)), bytes32(0), salt, delay
    );
  }

  /// @notice Rotates router pauser hook and ism after a pause.
  function rotateRouterPausable() external returns (address hook, address ism) {
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    vm.startBroadcast(acct("exactly"));

    (address[] memory modules,) =
      IStaticAggregationIsm(address(HypXERC20(router).interchainSecurityModule())).modulesAndThreshold("");
    (hook, ism) = _deployAggregations(
      StaticAggregationHook(address(HypXERC20(router).hook())).hooks("")[0],
      _deployPausableHook(acct("pauser")),
      modules[0],
      _deployPausableIsm(acct("pauser"))
    );
    HypXERC20(router).setHook(hook);
    HypXERC20(router).setInterchainSecurityModule(ism);

    vm.stopBroadcast();
  }

  /// @notice Refreshes router hook and ism with new defaults from the Mailbox.
  function refreshDefaults() external returns (address hook, address ism) {
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    vm.startBroadcast(acct("exactly"));

    address[] memory hooks = StaticAggregationHook(address(HypXERC20(router).hook())).hooks("");
    (address[] memory modules,) =
      IStaticAggregationIsm(address(HypXERC20(router).interchainSecurityModule())).modulesAndThreshold("");
    (hook, ism) = _deployAggregations(hooks[0], hooks[1], modules[0], modules[1]);
    HypXERC20(router).setHook(hook);
    HypXERC20(router).setInterchainSecurityModule(ism);

    vm.stopBroadcast();
  }

  function _deployAggregations(address exactlyHook, address pauserHook, address exactlyIsm, address pauserIsm)
    internal
    returns (address aggregationHook, address aggregationIsm)
  {
    address mailbox = acct("hyperlaneMailbox");
    address[] memory hooks = new address[](3);
    hooks[0] = exactlyHook;
    hooks[1] = pauserHook;
    hooks[2] = address(IMailbox(mailbox).defaultHook());
    aggregationHook = IStaticAggregationHookFactory(acct("hyperlaneStaticAggregationHookFactory")).deploy(hooks);

    address[] memory isms = new address[](3);
    isms[0] = exactlyIsm;
    isms[1] = pauserIsm;
    isms[2] = address(IMailbox(mailbox).defaultIsm());
    aggregationIsm = IStaticAggregationIsmFactory(acct("hyperlaneStaticAggregationIsmFactory")).deploy(isms, 3);
  }

  function _deployPausableHook(address owner) internal returns (address hook) {
    hook = address(new PausableHook());
    PausableHook(hook).transferOwnership(owner);
  }

  function _deployPausableIsm(address owner) internal returns (address ism) {
    ism = address(new PausableIsm(owner));
  }
}

error AlreadyGranted();
error RouterNotDeployed();

interface IStaticAggregationHookFactory {
  function deploy(address[] calldata values) external returns (address);
  function getAddress(address[] calldata values) external view returns (address);
}

interface IStaticAggregationIsm {
  function modulesAndThreshold(bytes calldata) external view returns (address[] memory, uint8);
}

interface IStaticAggregationIsmFactory {
  function deploy(address[] calldata values, uint8 threshold) external returns (address);
  function getAddress(address[] calldata values, uint8 threshold) external view returns (address);
}
