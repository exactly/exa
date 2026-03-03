// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { EXA } from "@exactly/protocol/periphery/EXA.sol";
import { TypeCasts } from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import { Redeployer, RouterNotDeployed } from "../script/Redeployer.s.sol";
import { ForkTest } from "./Fork.t.sol";

contract HypEXATest is ForkTest {
  using TypeCasts for address;

  uint256 internal opFork;
  uint256 internal baseFork;
  HypXERC20 internal opRouter;
  HypXERC20 internal baseRouter;
  address internal admin;
  address internal opMailbox;
  address internal baseMailbox;
  EXA internal exa = EXA(0x1e925De1c68ef83bD98eE3E130eF14a50309C01B);
  address internal exaHolder = 0x92024C4bDa9DA602b711B9AbB610d072018eb58b;

  uint32 internal constant OP_DOMAIN = 10;
  uint32 internal constant BASE_DOMAIN = 8453;

  function setUp() external {
    baseFork = vm.createSelectFork("base", 42_380_000);
    baseMailbox = acct("mailbox");
    Redeployer baseRedeployer = new Redeployer();
    baseRedeployer.setUp();
    if (address(baseRedeployer.proxyAdmin()).code.length == 0) baseRedeployer.prepare();
    baseRedeployer.proxyThrough(baseRedeployer.findNonce(acct("deployer"), address(exa), 1000) + 1);
    baseRedeployer.deployEXA(address(exa));
    baseRouter = baseRedeployer.deployRouter(address(exa));
    baseRedeployer.setupRouter(address(exa), OP_DOMAIN);

    opFork = vm.createSelectFork("optimism", 147_967_000);
    opMailbox = acct("mailbox");
    admin = acct("admin");
    Redeployer opRedeployer = new Redeployer();
    opRedeployer.setUp();
    opRedeployer.prepare();
    opRedeployer.deployEXAImpl();
    opRedeployer.upgradeEXA(address(exa));
    opRouter = opRedeployer.deployRouter(address(exa));
    opRedeployer.setupRouter(address(exa), BASE_DOMAIN);
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

  function test_transferRemote_reverts_withoutBridgeRole() external {
    vm.prank(admin);
    exa.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    uint256 fee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(exaHolder, fee);
    vm.prank(exaHolder);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(BASE_DOMAIN, makeAddr("receiver").addressToBytes32(), 100e18);
  }

  function test_handle_reverts_withoutBridgeRole() external {
    vm.selectFork(baseFork);
    vm.prank(admin);
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
    redeployer.setupRouter(address(exa), OP_DOMAIN);
  }

  // solhint-enable func-name-mixedcase
}
