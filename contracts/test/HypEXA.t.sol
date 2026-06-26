// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { IAccessControl } from "openzeppelin-contracts/contracts/access/IAccessControl.sol";
import { TimelockController } from "openzeppelin-contracts/contracts/governance/TimelockController.sol";
import { ERC1967Utils } from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import {
  ITransparentUpgradeableProxy
} from "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";
import { IPausable, Pauser } from "@exactly/protocol/periphery/Pauser.sol";
import { DefaultHook } from "@hyperlane-xyz/core/contracts/hooks/DefaultHook.sol";
import { PausableHook } from "@hyperlane-xyz/core/contracts/hooks/PausableHook.sol";
import { StaticAggregationHook } from "@hyperlane-xyz/core/contracts/hooks/aggregation/StaticAggregationHook.sol";
import { IInterchainSecurityModule } from "@hyperlane-xyz/core/contracts/interfaces/IInterchainSecurityModule.sol";
import { IMailbox } from "@hyperlane-xyz/core/contracts/interfaces/IMailbox.sol";
import { PausableIsm } from "@hyperlane-xyz/core/contracts/isms/PausableIsm.sol";
import { DefaultFallbackRoutingIsm } from "@hyperlane-xyz/core/contracts/isms/routing/DefaultFallbackRoutingIsm.sol";
import { TypeCasts } from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import {
  AlreadyGranted,
  HypEXA,
  IStaticAggregationHookFactory,
  IStaticAggregationIsm,
  IStaticAggregationIsmFactory,
  RouterNotDeployed,
  UnsupportedChain
} from "../script/HypEXA.s.sol";
import { Redeployer } from "../script/Redeployer.s.sol";
import { ForkTest } from "./Fork.t.sol";

contract HypEXATest is ForkTest {
  using TypeCasts for address;

  uint256 internal opFork;
  uint256 internal baseFork;
  uint256 internal polygonFork;
  HypXERC20 internal opRouter;
  HypXERC20 internal baseRouter;
  HypXERC20 internal polygonRouter;
  Redeployer internal opRedeployer;
  HypEXA internal opHypEXA;
  address internal opMailbox;
  address internal baseMailbox;
  address internal polygonMailbox;
  EXA internal exa = EXA(0x1e925De1c68ef83bD98eE3E130eF14a50309C01B);
  address internal exaHolder = 0x92024C4bDa9DA602b711B9AbB610d072018eb58b;

  function setUp() external {
    opHypEXA = new HypEXA();
    polygonFork = vm.createSelectFork("polygon", 83_700_000);
    polygonMailbox = acct("hyperlaneMailbox");
    Redeployer polygonRedeployer = new Redeployer();
    polygonRedeployer.setUp();
    if (address(polygonRedeployer.proxyAdmin()).code.length == 0) polygonRedeployer.prepare();
    polygonRedeployer.proxyThrough(polygonRedeployer.findNonce(acct("deployer"), address(exa), 1000) + 1);
    set("exactly", makeAddr("exactly")); // no exactly on polygon — test-only chain
    set("TimelockController", makeAddr("exactly"));
    set("pauser", makeAddr("pauser"));
    set("ProxyAdmin", address(polygonRedeployer.proxyAdmin())); // no protocol deployment on polygon
    polygonRedeployer.deployEXA();
    uint32[] memory polygonRemotes = new uint32[](2);
    polygonRemotes[0] = uint32(getChain("optimism").chainId);
    polygonRemotes[1] = uint32(getChain("base").chainId);
    polygonRouter = new HypEXA().deployRouter(polygonRemotes);
    unset("ProxyAdmin");
    vm.prank(makeAddr("exactly"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(polygonRouter));
    unset("exactly");
    unset("TimelockController");
    unset("pauser");

    baseFork = vm.createSelectFork("base", 42_380_000);
    baseMailbox = acct("hyperlaneMailbox");
    Redeployer baseRedeployer = new Redeployer();
    baseRedeployer.setUp();
    if (address(baseRedeployer.proxyAdmin()).code.length == 0) baseRedeployer.prepare();
    baseRedeployer.proxyThrough(baseRedeployer.findNonce(acct("deployer"), address(exa), 1000) + 1);
    baseRedeployer.deployEXA();
    uint32[] memory baseRemotes = new uint32[](2);
    baseRemotes[0] = uint32(getChain("optimism").chainId);
    baseRemotes[1] = uint32(getChain("polygon").chainId);
    baseRouter = new HypEXA().deployRouter(baseRemotes);
    vm.prank(protocol("TimelockController"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(baseRouter));

    opFork = vm.createSelectFork("optimism", 147_967_000);
    opMailbox = acct("hyperlaneMailbox");
    opRedeployer = new Redeployer();
    opRedeployer.setUp();
    opRedeployer.prepare();
    opRedeployer.deployEXAImpl();
    _upgradeEXA(address(exa), address(opRedeployer.exa()));
    uint32[] memory opRemotes = new uint32[](2);
    opRemotes[0] = uint32(getChain("base").chainId);
    opRemotes[1] = uint32(getChain("polygon").chainId);
    opRouter = opHypEXA.deployRouter(opRemotes);
    vm.prank(protocol("TimelockController"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(opRouter));
    assertEq(opRouter.owner(), acct("exactly"), "router owner");
    assertEq(
      opRouter.routers(uint32(getChain("base").chainId)),
      bytes32(uint256(uint160(address(opRouter)))),
      "base enrollment"
    );
  }

  // solhint-disable func-name-mixedcase

  function test_roundTrip_opToBaseToOp() external {
    address receiver = makeAddr("receiver");
    uint256 amount = 100e18;
    uint256 opSupply = exa.totalSupply();

    uint256 fee = opRouter.quoteGasPayment(uint32(getChain("base").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(uint32(getChain("base").chainId), exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), opSupply - amount, "op didn't burn");

    vm.selectFork(baseFork);
    vm.prank(baseMailbox);
    baseRouter.handle(
      uint32(getChain("optimism").chainId),
      address(opRouter).addressToBytes32(),
      abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.balanceOf(exaHolder), amount, "base didn't credit holder");
    assertEq(exa.totalSupply(), amount, "base didn't mint");

    fee = baseRouter.quoteGasPayment(uint32(getChain("optimism").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    baseRouter.transferRemote{ value: fee }(uint32(getChain("optimism").chainId), receiver.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), 0, "base didn't burn");

    vm.selectFork(opFork);
    vm.prank(opMailbox);
    opRouter.handle(
      uint32(getChain("base").chainId),
      address(baseRouter).addressToBytes32(),
      abi.encodePacked(receiver.addressToBytes32(), amount)
    );
    assertEq(exa.balanceOf(receiver), amount, "op didn't credit receiver");
    assertEq(exa.totalSupply(), opSupply, "op didn't restore supply");
  }

  function test_roundTrip_opToPolygonToBaseToOp() external {
    uint256 amount = 100e18;
    uint256 opSupply = exa.totalSupply();

    uint256 fee = opRouter.quoteGasPayment(uint32(getChain("polygon").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(uint32(getChain("polygon").chainId), exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), opSupply - amount, "op didn't burn");

    vm.selectFork(polygonFork);
    uint256 polygonSupply = exa.totalSupply();
    vm.prank(polygonMailbox);
    polygonRouter.handle(
      uint32(getChain("optimism").chainId),
      address(opRouter).addressToBytes32(),
      abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), polygonSupply + amount, "polygon didn't mint");

    fee = polygonRouter.quoteGasPayment(uint32(getChain("base").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    polygonRouter.transferRemote{ value: fee }(uint32(getChain("base").chainId), exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), polygonSupply, "polygon didn't burn");

    vm.selectFork(baseFork);
    uint256 baseSupply = exa.totalSupply();
    vm.prank(baseMailbox);
    baseRouter.handle(
      uint32(getChain("polygon").chainId),
      address(polygonRouter).addressToBytes32(),
      abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), baseSupply + amount, "base didn't mint");

    fee = baseRouter.quoteGasPayment(uint32(getChain("optimism").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    baseRouter.transferRemote{ value: fee }(uint32(getChain("optimism").chainId), exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), baseSupply, "base didn't burn");

    vm.selectFork(opFork);
    vm.prank(opMailbox);
    opRouter.handle(
      uint32(getChain("base").chainId),
      address(baseRouter).addressToBytes32(),
      abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), opSupply, "op didn't restore supply");
  }

  function test_transferRemote_reverts_withoutBridgeRole() external {
    vm.prank(protocol("TimelockController"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    uint256 fee = opRouter.quoteGasPayment(uint32(getChain("base").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );
  }

  function test_handle_reverts_withoutBridgeRole() external {
    vm.selectFork(baseFork);
    vm.prank(protocol("TimelockController"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(baseRouter));

    vm.prank(baseMailbox);
    vm.expectRevert();
    baseRouter.handle(
      uint32(getChain("optimism").chainId),
      address(opRouter).addressToBytes32(),
      abi.encodePacked(makeAddr("receiver").addressToBytes32(), uint256(100e18))
    );
  }

  function test_proposeBridgeRole_reverts_whenRouterNotDeployed() external {
    vm.createSelectFork("base", 42_380_001);

    HypEXA hypEXA = new HypEXA();

    vm.expectRevert(RouterNotDeployed.selector);
    hypEXA.proposeBridgeRole(keccak256("HypEXA.BRIDGE_ROLE"));
  }

  function test_proposeBridgeRole_schedulesGrantOnTimelock() external {
    vm.selectFork(opFork);
    vm.prank(protocol("TimelockController"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    bytes32 salt = keccak256("HypEXA.BRIDGE_ROLE");
    opHypEXA.proposeBridgeRole(salt);

    TimelockController timelock = TimelockController(payable(protocol("TimelockController")));
    bytes32 id = timelock.hashOperation(
      address(exa),
      0,
      abi.encodeCall(IAccessControl.grantRole, (keccak256("BRIDGE_ROLE"), address(opRouter))),
      bytes32(0),
      salt
    );
    assertTrue(timelock.isOperationPending(id), "grant not scheduled");
  }

  function test_proposeBridgeRole_reverts_whenAlreadyGranted() external {
    vm.selectFork(opFork);
    vm.expectRevert(AlreadyGranted.selector);
    opHypEXA.proposeBridgeRole(keccak256("HypEXA.BRIDGE_ROLE"));
  }

  function test_deployRouter_setsHookAndIsm() external {
    vm.selectFork(opFork);
    address aggregationHook = address(opRouter.hook());
    address[] memory hooks = StaticAggregationHook(aggregationHook).hooks("");
    assertEq(hooks.length, 3, "hook count");
    assertEq(
      aggregationHook,
      IStaticAggregationHookFactory(acct("hyperlaneAggregationHookFactory")).getAddress(hooks),
      "hook not set"
    );
    assertEq(PausableHook(hooks[0]).owner(), acct("exactly"), "exactly hook owner");
    (address[] memory modules,) =
      IStaticAggregationIsm(address(opRouter.interchainSecurityModule())).modulesAndThreshold("");
    address exactlyIsm = modules[0];
    address pauserIsm = modules[1];
    assertEq(PausableHook(hooks[1]).owner(), PausableIsm(pauserIsm).owner(), "pauser hook owner");
    assertEq(address(DefaultHook(hooks[2]).mailbox()), opMailbox, "default hook mailbox");
    assertEq(DefaultFallbackRoutingIsm(modules[2]).owner(), acct("exactly"), "default ism owner");
    assertEq(address(DefaultHook(hooks[2])._hook()), address(IMailbox(opMailbox).defaultHook()), "default hook");
    assertEq(
      address(DefaultFallbackRoutingIsm(modules[2]).module(uint32(getChain("base").chainId))),
      address(IMailbox(opMailbox).defaultIsm()),
      "default ism"
    );
    address[] memory isms = new address[](3);
    isms[0] = exactlyIsm;
    isms[1] = pauserIsm;
    isms[2] = modules[2];
    assertEq(
      address(opRouter.interchainSecurityModule()),
      IStaticAggregationIsmFactory(acct("hyperlaneAggregationIsmFactory")).getAddress(isms, 3),
      "ism not set"
    );
  }

  function test_deployRouter_enrollsBase_whenNoRemotesOnOptimism() external {
    vm.createSelectFork("optimism", 147_967_000);
    HypXERC20 router = new HypEXA().deployRouter(new uint32[](0));
    assertEq(router.routers(uint32(getChain("base").chainId)), address(router).addressToBytes32(), "base not enrolled");
    assertEq(router.routers(uint32(getChain("optimism").chainId)), bytes32(0), "optimism self-enrolled");
  }

  function test_deployRouter_enrollsOptimism_whenNoRemotesOnBase() external {
    vm.createSelectFork("base", 42_380_000);
    HypXERC20 router = new HypEXA().deployRouter(new uint32[](0));
    assertEq(
      router.routers(uint32(getChain("optimism").chainId)), address(router).addressToBytes32(), "optimism not enrolled"
    );
    assertEq(router.routers(uint32(getChain("base").chainId)), bytes32(0), "base self-enrolled");
  }

  function test_deployRouter_reverts_whenNoRemotesOnUnsupportedChain() external {
    vm.createSelectFork("polygon", 83_700_000);
    HypEXA hypEXA = new HypEXA();
    vm.expectRevert(abi.encodeWithSelector(UnsupportedChain.selector, uint32(getChain("polygon").chainId)));
    hypEXA.deployRouter(new uint32[](0));
  }

  function test_transferRemote_reverts_whenHookPaused() external {
    address exactlyHook = StaticAggregationHook(address(opRouter.hook())).hooks("")[0];
    address pauserHook = StaticAggregationHook(address(opRouter.hook())).hooks("")[1];

    vm.prank(acct("exactly"));
    PausableHook(exactlyHook).pause();

    uint256 fee = opRouter.quoteGasPayment(uint32(getChain("base").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );

    vm.prank(acct("exactly"));
    PausableHook(exactlyHook).unpause();

    vm.prank(acct("pauser"));
    PausableHook(pauserHook).pause();

    vm.prank(exaHolder);
    vm.expectRevert("Pausable: paused");
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );

    vm.prank(acct("pauser"));
    PausableHook(pauserHook).unpause();

    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );
  }

  function test_process_reverts_whenIsmPaused() external {
    vm.selectFork(baseFork);
    address mailbox = baseMailbox;
    (address[] memory modules,) =
      IStaticAggregationIsm(address(baseRouter.interchainSecurityModule())).modulesAndThreshold("");
    address exactlyIsm = modules[0];
    address pauserIsm = modules[1];
    address defaultIsm = address(IMailbox(mailbox).defaultIsm());

    vm.prank(PausableIsm(pauserIsm).owner());
    PausableIsm(pauserIsm).pause();

    bytes memory message = abi.encodePacked(
      uint8(3),
      type(uint32).max,
      uint32(getChain("optimism").chainId),
      address(opRouter).addressToBytes32(),
      IMailbox(mailbox).localDomain(),
      address(baseRouter).addressToBytes32(),
      exaHolder.addressToBytes32(),
      uint256(100e18)
    );
    uint32 offset = 24;
    bytes memory metadata = abi.encodePacked(offset, offset, offset, offset, offset, offset);

    vm.expectRevert(bytes("Pausable: paused"));
    IMailbox(mailbox).process(metadata, message);
    assertEq(exa.balanceOf(exaHolder), 0, "handle ran despite failed verify");

    vm.prank(PausableIsm(pauserIsm).owner());
    PausableIsm(pauserIsm).unpause();

    vm.prank(PausableIsm(exactlyIsm).owner());
    PausableIsm(exactlyIsm).pause();

    vm.expectRevert(bytes("Pausable: paused"));
    IMailbox(mailbox).process(metadata, message);
    assertEq(exa.balanceOf(exaHolder), 0, "handle ran despite failed verify");

    vm.prank(PausableIsm(exactlyIsm).owner());
    PausableIsm(exactlyIsm).unpause();

    // Mock the default ISM to return true
    vm.mockCall(defaultIsm, IInterchainSecurityModule.verify.selector, abi.encode(true));
    IMailbox(mailbox).process(metadata, message);
    assertEq(exa.balanceOf(exaHolder), 100e18, "handle didn't execute after unpausing isms");
  }

  function test_pause_pausesHookAndIsmViaPauser() external {
    vm.selectFork(opFork);
    address pauser = acct("pauser");
    address pauserHook = StaticAggregationHook(address(opRouter.hook())).hooks("")[1];
    (address[] memory modules,) =
      IStaticAggregationIsm(address(opRouter.interchainSecurityModule())).modulesAndThreshold("");
    address pauserIsm = modules[1];
    assertEq(PausableHook(pauserHook).owner(), pauser, "pauser hook owner");
    assertEq(PausableIsm(pauserIsm).owner(), pauser, "pauser ism owner");

    IPausable[] memory targets = new IPausable[](2);
    targets[0] = IPausable(pauserHook);
    targets[1] = IPausable(pauserIsm);

    vm.prank(Pauser(pauser).owner());
    Pauser(pauser).pause(targets);
    assertTrue(PausableHook(pauserHook).paused());
    assertTrue(PausableIsm(pauserIsm).paused());
  }

  function test_hookAndIsm_trackMailboxDefaults_withoutRedeploy() external {
    vm.selectFork(opFork);

    address aggregationHook = address(opRouter.hook());
    address aggregationIsm = address(opRouter.interchainSecurityModule());
    address[] memory hooks = StaticAggregationHook(aggregationHook).hooks("");
    (address[] memory modules,) = IStaticAggregationIsm(aggregationIsm).modulesAndThreshold("");
    address defaultHook = hooks[2];
    address defaultIsm = modules[2];

    vm.mockCall(opMailbox, IMailbox.defaultHook.selector, abi.encode(makeAddr("newDefaultHook")));
    vm.mockCall(opMailbox, IMailbox.defaultIsm.selector, abi.encode(makeAddr("newDefaultIsm")));

    assertEq(address(opRouter.hook()), aggregationHook, "hook aggregation redeployed");
    assertEq(address(opRouter.interchainSecurityModule()), aggregationIsm, "ism aggregation redeployed");
    assertEq(defaultHook, StaticAggregationHook(aggregationHook).hooks("")[2], "default hook proxy changed");
    (address[] memory isms,) = IStaticAggregationIsm(aggregationIsm).modulesAndThreshold("");
    assertEq(defaultIsm, isms[2], "default ism proxy changed");
    assertEq(address(DefaultHook(hooks[2])._hook()), address(IMailbox(opMailbox).defaultHook()), "default hook");
    assertEq(
      address(DefaultFallbackRoutingIsm(modules[2]).module(uint32(getChain("base").chainId))),
      address(IMailbox(opMailbox).defaultIsm()),
      "default ism"
    );
  }

  function test_rotateRouterPausable_restoresTransferRemoteAfterPauserHookPaused() external {
    vm.selectFork(opFork);
    address pauser = acct("pauser");
    address oldAggregation = address(opRouter.hook());
    address exactlyHook = StaticAggregationHook(oldAggregation).hooks("")[0];
    address oldPauserHook = StaticAggregationHook(oldAggregation).hooks("")[1];
    IPausable[] memory targets = new IPausable[](1);
    targets[0] = IPausable(oldPauserHook);
    vm.prank(Pauser(pauser).owner());
    Pauser(pauser).pause(targets);
    assertTrue(PausableHook(oldPauserHook).paused());
    uint256 fee = opRouter.quoteGasPayment(uint32(getChain("base").chainId));
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );
    opHypEXA.rotateRouterPausable();
    address newAggregation = address(opRouter.hook());
    address newPauserHook = StaticAggregationHook(newAggregation).hooks("")[1];
    assertTrue(newAggregation != oldAggregation, "aggregation unchanged");
    assertEq(StaticAggregationHook(newAggregation).hooks("")[0], exactlyHook, "exactly hook not reused");
    assertTrue(newPauserHook != oldPauserHook, "pauser hook not rotated");
    assertFalse(PausableHook(newPauserHook).paused(), "new pauser hook paused");
    assertTrue(PausableHook(oldPauserHook).paused(), "old pauser hook unpaused");
    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(
      uint32(getChain("base").chainId), makeAddr("receiver").addressToBytes32(), 100e18
    );
  }

  function test_rotateRouterPausable_restoresProcessAfterPauserIsmPaused() external {
    vm.selectFork(baseFork);

    address mailbox = baseMailbox;
    address oldAggregation = address(baseRouter.interchainSecurityModule());
    (address[] memory oldModules,) = IStaticAggregationIsm(oldAggregation).modulesAndThreshold("");
    address exactlyIsm = oldModules[0];
    address oldPauserIsm = oldModules[1];
    address defaultIsm = address(IMailbox(mailbox).defaultIsm());

    vm.prank(PausableIsm(oldPauserIsm).owner());
    PausableIsm(oldPauserIsm).pause();

    bytes memory message = abi.encodePacked(
      uint8(3),
      type(uint32).max,
      uint32(getChain("optimism").chainId),
      address(opRouter).addressToBytes32(),
      IMailbox(mailbox).localDomain(),
      address(baseRouter).addressToBytes32(),
      exaHolder.addressToBytes32(),
      uint256(100e18)
    );
    uint32 offset = 24;
    bytes memory metadata = abi.encodePacked(offset, offset, offset, offset, offset, offset);

    vm.expectRevert(bytes("Pausable: paused"));
    IMailbox(mailbox).process(metadata, message);

    new HypEXA().rotateRouterPausable();

    (address[] memory newModules,) =
      IStaticAggregationIsm(address(baseRouter.interchainSecurityModule())).modulesAndThreshold("");
    address newPauserIsm = newModules[1];
    assertTrue(address(baseRouter.interchainSecurityModule()) != oldAggregation, "aggregation unchanged");
    assertTrue(newPauserIsm != oldPauserIsm, "pauser ism not rotated");
    assertFalse(PausableIsm(newPauserIsm).paused(), "new pauser ism paused");
    assertTrue(PausableIsm(oldPauserIsm).paused(), "old pauser ism unpaused");
    assertEq(newModules[0], exactlyIsm, "exactly ism not reused");

    vm.mockCall(defaultIsm, IInterchainSecurityModule.verify.selector, abi.encode(true));
    IMailbox(mailbox).process(metadata, message);
    assertEq(exa.balanceOf(exaHolder), 100e18, "handle didn't execute after rotation");
  }

  // solhint-enable func-name-mixedcase

  function _upgradeEXA(address proxy, address implementation) internal {
    ProxyAdmin p = ProxyAdmin(address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT)))));
    vm.prank(p.owner());
    p.upgradeAndCall(
      ITransparentUpgradeableProxy(proxy),
      implementation,
      abi.encodeCall(EXA.initialize2, (protocol("TimelockController")))
    );
  }
}
