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
import { TypeCasts } from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import { AlreadyGranted, Redeployer, RouterNotDeployed } from "../script/Redeployer.s.sol";
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
  address internal opMailbox;
  address internal baseMailbox;
  address internal polygonMailbox;
  EXA internal exa = EXA(0x1e925De1c68ef83bD98eE3E130eF14a50309C01B);
  address internal exaHolder = 0x92024C4bDa9DA602b711B9AbB610d072018eb58b;

  uint32 internal constant OP_DOMAIN = 10;
  uint32 internal constant BASE_DOMAIN = 8453;
  uint32 internal constant POLYGON_DOMAIN = 137;

  function setUp() external {
    polygonFork = vm.createSelectFork("polygon", 83_700_000);
    polygonMailbox = acct("mailbox");
    Redeployer polygonRedeployer = new Redeployer();
    polygonRedeployer.setUp();
    if (address(polygonRedeployer.proxyAdmin()).code.length == 0) polygonRedeployer.prepare();
    polygonRedeployer.proxyThrough(polygonRedeployer.findNonce(acct("deployer"), address(exa), 1000) + 1);
    set("exactly", makeAddr("exactly")); // no exactly on polygon — test-only chain
    set("ProxyAdmin", address(polygonRedeployer.proxyAdmin())); // no protocol deployment on polygon
    polygonRedeployer.deployEXA(address(exa));
    polygonRouter = polygonRedeployer.deployRouter(address(exa));
    unset("ProxyAdmin");
    vm.prank(makeAddr("exactly"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(polygonRouter));
    polygonRedeployer.setupRouter(OP_DOMAIN);
    polygonRedeployer.setupRouter(BASE_DOMAIN);
    unset("exactly");

    baseFork = vm.createSelectFork("base", 42_380_000);
    baseMailbox = acct("mailbox");
    Redeployer baseRedeployer = new Redeployer();
    baseRedeployer.setUp();
    if (address(baseRedeployer.proxyAdmin()).code.length == 0) baseRedeployer.prepare();
    baseRedeployer.proxyThrough(baseRedeployer.findNonce(acct("deployer"), address(exa), 1000) + 1);
    baseRedeployer.deployEXA(address(exa));
    baseRouter = baseRedeployer.deployRouter(address(exa));
    vm.prank(acct("exactly"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(baseRouter));
    baseRedeployer.setupRouter(OP_DOMAIN);
    baseRedeployer.setupRouter(POLYGON_DOMAIN);

    opFork = vm.createSelectFork("optimism", 147_967_000);
    opMailbox = acct("mailbox");
    opRedeployer = new Redeployer();
    opRedeployer.setUp();
    opRedeployer.prepare();
    opRedeployer.deployEXAImpl();
    _upgradeEXA(address(exa), address(opRedeployer.exa()));
    opRouter = opRedeployer.deployRouter(address(exa));
    vm.prank(acct("exactly"));
    exa.grantRole(keccak256("BRIDGE_ROLE"), address(opRouter));
    opRedeployer.setupRouter(BASE_DOMAIN);
    opRedeployer.setupRouter(POLYGON_DOMAIN);
  }

  // solhint-disable func-name-mixedcase

  function test_roundTrip_opToBaseToOp() external {
    address receiver = makeAddr("receiver");
    uint256 amount = 100e18;
    uint256 opSupply = exa.totalSupply();

    uint256 fee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(BASE_DOMAIN, exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), opSupply - amount, "op didn't burn");

    vm.selectFork(baseFork);
    vm.prank(baseMailbox);
    baseRouter.handle(
      OP_DOMAIN, address(opRouter).addressToBytes32(), abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.balanceOf(exaHolder), amount, "base didn't credit holder");
    assertEq(exa.totalSupply(), amount, "base didn't mint");

    fee = baseRouter.quoteGasPayment(OP_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    baseRouter.transferRemote{ value: fee }(OP_DOMAIN, receiver.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), 0, "base didn't burn");

    vm.selectFork(opFork);
    vm.prank(opMailbox);
    opRouter.handle(
      BASE_DOMAIN, address(baseRouter).addressToBytes32(), abi.encodePacked(receiver.addressToBytes32(), amount)
    );
    assertEq(exa.balanceOf(receiver), amount, "op didn't credit receiver");
    assertEq(exa.totalSupply(), opSupply, "op didn't restore supply");
  }

  function test_roundTrip_opToPolygonToBaseToOp() external {
    uint256 amount = 100e18;
    uint256 opSupply = exa.totalSupply();

    uint256 fee = opRouter.quoteGasPayment(POLYGON_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    opRouter.transferRemote{ value: fee }(POLYGON_DOMAIN, exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), opSupply - amount, "op didn't burn");

    vm.selectFork(polygonFork);
    uint256 polygonSupply = exa.totalSupply();
    vm.prank(polygonMailbox);
    polygonRouter.handle(
      OP_DOMAIN, address(opRouter).addressToBytes32(), abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), polygonSupply + amount, "polygon didn't mint");

    fee = polygonRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    polygonRouter.transferRemote{ value: fee }(BASE_DOMAIN, exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), polygonSupply, "polygon didn't burn");

    vm.selectFork(baseFork);
    uint256 baseSupply = exa.totalSupply();
    vm.prank(baseMailbox);
    baseRouter.handle(
      POLYGON_DOMAIN, address(polygonRouter).addressToBytes32(), abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), baseSupply + amount, "base didn't mint");

    fee = baseRouter.quoteGasPayment(OP_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    baseRouter.transferRemote{ value: fee }(OP_DOMAIN, exaHolder.addressToBytes32(), amount);
    assertEq(exa.totalSupply(), baseSupply, "base didn't burn");

    vm.selectFork(opFork);
    vm.prank(opMailbox);
    opRouter.handle(
      BASE_DOMAIN, address(baseRouter).addressToBytes32(), abi.encodePacked(exaHolder.addressToBytes32(), amount)
    );
    assertEq(exa.totalSupply(), opSupply, "op didn't restore supply");
  }

  function test_transferRemote_reverts_withoutBridgeRole() external {
    vm.prank(acct("exactly"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    uint256 fee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(BASE_DOMAIN, makeAddr("receiver").addressToBytes32(), 100e18);
  }

  function test_handle_reverts_withoutBridgeRole() external {
    vm.selectFork(baseFork);
    vm.prank(acct("exactly"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(baseRouter));

    vm.prank(baseMailbox);
    vm.expectRevert();
    baseRouter.handle(
      OP_DOMAIN,
      address(opRouter).addressToBytes32(),
      abi.encodePacked(makeAddr("receiver").addressToBytes32(), uint256(100e18))
    );
  }

  function test_setupRouter_reverts_whenRouterNotDeployed() external {
    vm.createSelectFork("base", 42_380_001);

    Redeployer redeployer = new Redeployer();
    redeployer.setUp();

    vm.expectRevert(RouterNotDeployed.selector);
    redeployer.setupRouter(OP_DOMAIN);
  }

  function test_proposeBridgeRole_reverts_whenRouterNotDeployed() external {
    vm.createSelectFork("base", 42_380_001);

    Redeployer redeployer = new Redeployer();
    redeployer.setUp();

    vm.expectRevert(RouterNotDeployed.selector);
    redeployer.proposeBridgeRole(address(exa), keccak256("HypEXA.BRIDGE_ROLE"));
  }

  function test_proposeBridgeRole_schedulesGrantOnTimelock() external {
    vm.selectFork(opFork);
    vm.prank(acct("exactly"));
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    bytes32 salt = keccak256("HypEXA.BRIDGE_ROLE");
    opRedeployer.proposeBridgeRole(address(exa), salt);

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
    opRedeployer.proposeBridgeRole(address(exa), keccak256("HypEXA.BRIDGE_ROLE"));
  }

  // solhint-enable func-name-mixedcase

  function _upgradeEXA(address proxy, address implementation) internal {
    ProxyAdmin p = ProxyAdmin(address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT)))));
    vm.prank(p.owner());
    p.upgradeAndCall(
      ITransparentUpgradeableProxy(proxy), implementation, abi.encodeCall(EXA.initialize2, (acct("exactly")))
    );
  }
}
