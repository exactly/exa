// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {
  TransparentUpgradeableProxy
} from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { TimelockController } from "openzeppelin-contracts/contracts/governance/TimelockController.sol";

import { DefaultHook } from "@hyperlane-xyz/core/contracts/hooks/DefaultHook.sol";
import { PausableHook } from "@hyperlane-xyz/core/contracts/hooks/PausableHook.sol";
import { StaticAggregationHook } from "@hyperlane-xyz/core/contracts/hooks/aggregation/StaticAggregationHook.sol";
import { PausableIsm } from "@hyperlane-xyz/core/contracts/isms/PausableIsm.sol";
import { DefaultFallbackRoutingIsm } from "@hyperlane-xyz/core/contracts/isms/routing/DefaultFallbackRoutingIsm.sol";
import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import { BaseScript } from "./Base.s.sol";

/// @title HypEXA
/// @notice Deploys and maintains the Hyperlane HypXERC20 router for EXA.
contract HypEXA is BaseScript {
  function deployRouter(uint32[] calldata remoteDomains) external returns (HypXERC20 router) {
    address admin = acct("admin");
    address exa = protocol("EXA", true, getChain("optimism").chainId);
    router = HypXERC20(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXA"))));
    if (address(router).code.length != 0) return router;

    uint32[] memory domains = remoteDomains;
    if (domains.length == 0) {
      domains = new uint32[](1);
      if (block.chainid == getChain("optimism").chainId) domains[0] = uint32(getChain("base").chainId);
      else if (block.chainid == getChain("base").chainId) domains[0] = uint32(getChain("optimism").chainId);
      else revert UnsupportedChain(block.chainid);
    }

    vm.startBroadcast(admin);

    (address hook, address ism) = _deployAggregations(
      _deployPausableHook(acct("exactly")),
      _deployPausableHook(acct("pauser")),
      _deployDefaultHook(),
      _deployPausableIsm(acct("exactly")),
      _deployPausableIsm(acct("pauser")),
      _deployDefaultIsm()
    );

    address impl = CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXAImpl")));
    if (impl.code.length == 0) {
      impl = CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXAImpl")),
        abi.encodePacked(type(HypXERC20).creationCode, abi.encode(exa, 1, 1, acct("hyperlaneMailbox")))
      );
    }

    router = HypXERC20(
      CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXA")),
        abi.encodePacked(
          type(TransparentUpgradeableProxy).creationCode,
          abi.encode(impl, protocol("ProxyAdmin"), abi.encodeCall(HypERC20Collateral.initialize, (hook, ism, admin)))
        )
      )
    );

    bytes32[] memory addresses = new bytes32[](domains.length);
    bytes32 remote = bytes32(uint256(uint160(address(router))));
    for (uint256 i = 0; i < domains.length; ++i) {
      addresses[i] = remote;
    }
    router.enrollRemoteRouters(domains, addresses);

    router.transferOwnership(acct("exactly"));
    vm.stopBroadcast();
  }

  function proposeBridgeRole() external {
    bytes32 salt = keccak256("propose-exa-bridge-role");
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    address exa = protocol("EXA", true, getChain("optimism").chainId);
    if (IAccessControl(exa).hasRole(keccak256("BRIDGE_ROLE"), router)) revert AlreadyGranted();
    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    uint256 delay = timelock.getMinDelay();
    vm.broadcast(acct("deployer"));
    timelock.schedule(
      exa, 0, abi.encodeCall(IAccessControl.grantRole, (keccak256("BRIDGE_ROLE"), router)), bytes32(0), salt, delay
    );
  }

  /// @notice Rotates router pauser hook and ism after a pause.
  function rotateRouterPausable() external returns (address hook, address ism) {
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    vm.startBroadcast(acct("exactly"));

    address[] memory hooks = StaticAggregationHook(address(HypXERC20(router).hook())).hooks("");
    (address[] memory modules,) =
      IStaticAggregationIsm(address(HypXERC20(router).interchainSecurityModule())).modulesAndThreshold("");
    _expectOwner(hooks[0], acct("exactly"));
    _expectOwner(modules[0], acct("exactly"));
    (hook, ism) = _deployAggregations(
      hooks[0],
      _deployPausableHook(acct("pauser")),
      hooks[2],
      modules[0],
      _deployPausableIsm(acct("pauser")),
      modules[2]
    );
    HypXERC20(router).setHook(hook);
    HypXERC20(router).setInterchainSecurityModule(ism);

    vm.stopBroadcast();
  }

  function _deployAggregations(
    address exactlyHook,
    address pauserHook,
    address defaultHook,
    address exactlyIsm,
    address pauserIsm,
    address defaultIsm
  ) internal returns (address aggregationHook, address aggregationIsm) {
    address[] memory hooks = new address[](3);
    hooks[0] = exactlyHook;
    hooks[1] = pauserHook;
    hooks[2] = defaultHook;
    aggregationHook = IStaticAggregationHookFactory(acct("hyperlaneAggregationHookFactory")).deploy(hooks);

    address[] memory isms = new address[](3);
    isms[0] = exactlyIsm;
    isms[1] = pauserIsm;
    isms[2] = defaultIsm;
    aggregationIsm = IStaticAggregationIsmFactory(acct("hyperlaneAggregationIsmFactory")).deploy(isms, 3);
  }

  function _deployDefaultHook() internal returns (address hook) {
    address admin = acct("admin");
    hook = CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXADefaultHook")));
    if (hook.code.length == 0) {
      hook = CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXADefaultHook")),
        abi.encodePacked(type(DefaultHook).creationCode, abi.encode(acct("hyperlaneMailbox")))
      );
    }
  }

  function _deployDefaultIsm() internal returns (address ism) {
    address admin = acct("admin");
    address impl = CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXADefaultIsmImpl")));
    if (impl.code.length == 0) {
      impl = CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXADefaultIsmImpl")),
        abi.encodePacked(type(DefaultFallbackRoutingIsm).creationCode, abi.encode(acct("hyperlaneMailbox")))
      );
    }
    ism = CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXADefaultIsm")));
    if (ism.code.length == 0) {
      ism = CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXADefaultIsm")),
        abi.encodePacked(
          type(TransparentUpgradeableProxy).creationCode,
          abi.encode(impl, protocol("ProxyAdmin"), abi.encodeCall(IRoutingIsmInitializer.initialize, (acct("exactly"))))
        )
      );
    }
  }

  function _deployPausableHook(address owner) internal returns (address hook) {
    address factory = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("PausableHookFactory")));
    if (factory.code.length == 0) {
      factory =
        CREATE3_FACTORY.deploy(keccak256(abi.encode("PausableHookFactory")), type(PausableHookFactory).creationCode);
    }
    hook = address(PausableHookFactory(factory).deploy(owner));
  }

  function _deployPausableIsm(address owner) internal returns (address ism) {
    address factory = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("PausableIsmFactory")));
    if (factory.code.length == 0) {
      factory =
        CREATE3_FACTORY.deploy(keccak256(abi.encode("PausableIsmFactory")), type(PausableIsmFactory).creationCode);
    }
    ism = address(PausableIsmFactory(factory).deploy(owner));
  }

  function _expectOwner(address target, address owner) internal view {
    if (PausableHook(target).owner() != owner) revert UnexpectedOwner(target, owner);
  }
}

error AlreadyGranted();
error RouterNotDeployed();
error UnexpectedOwner(address target, address owner);
error UnsupportedChain(uint256 chainid);

contract PausableHookFactory {
  function deploy(address owner) external returns (PausableHook hook) {
    hook = new PausableHook();
    hook.transferOwnership(owner);
  }
}

contract PausableIsmFactory {
  function deploy(address owner) external returns (PausableIsm ism) {
    ism = new PausableIsm(owner);
  }
}

interface IStaticAggregationHookFactory {
  function deploy(address[] calldata values) external returns (address);
  function getAddress(address[] calldata values) external view returns (address);
}

interface IRoutingIsmInitializer {
  function initialize(address owner) external;
}

interface IStaticAggregationIsm {
  function modulesAndThreshold(bytes calldata) external view returns (address[] memory, uint8);
}

interface IStaticAggregationIsmFactory {
  function deploy(address[] calldata values, uint8 threshold) external returns (address);
  function getAddress(address[] calldata values, uint8 threshold) external view returns (address);
}
