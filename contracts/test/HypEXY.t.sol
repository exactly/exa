// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { Redeployer } from "../script/Redeployer.s.sol";
import { EXYv2 } from "../src/EXYv2.sol";
import { ForkTest } from "./Fork.t.sol";
import { TypeCasts } from "@hyperlane-xyz/core/contracts/libs/TypeCasts.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

contract HypEXYTest is ForkTest {
  using TypeCasts for address;

  uint256 internal opFork;
  uint256 internal baseFork;
  HypXERC20 internal opRouter;
  HypXERC20 internal baseRouter;
  address internal admin;
  EXYv2 internal exy = EXYv2(0xE86f49CB2D19e5Dfc38baCCCa721B28Abc70527c);

  uint32 internal constant OP_DOMAIN = 10;
  uint32 internal constant BASE_DOMAIN = 8453;
  address internal constant OP_MAILBOX = 0xd4C1905BB1D26BC93DAC913e13CaCC278CdCC80D;
  address internal constant BASE_MAILBOX = 0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D;

  function setUp() external {
    baseFork = vm.createSelectFork("base", 42_380_000);
    Redeployer baseRedeployer = new Redeployer();
    baseRedeployer.setUp();
    if (address(baseRedeployer.proxyAdmin()).code.length == 0) baseRedeployer.prepare();
    baseRouter = baseRedeployer.deployRouter(address(exy), 1, BASE_MAILBOX);

    opFork = vm.createSelectFork("optimism", 147_967_000);
    admin = acct("admin");

    Redeployer opRedeployer = new Redeployer();
    opRedeployer.setUp();
    if (address(opRedeployer.proxyAdmin()).code.length == 0) opRedeployer.prepare();
    opRouter = opRedeployer.deployRouter(address(exy), 1, OP_MAILBOX);

    vm.startPrank(admin);
    exy.grantRole(keccak256("BRIDGE_ROLE"), address(opRouter));
    opRouter.enrollRemoteRouter(BASE_DOMAIN, address(baseRouter).addressToBytes32());
    vm.stopPrank();

    vm.selectFork(baseFork);
    vm.startPrank(admin);
    exy.grantRole(keccak256("BRIDGE_ROLE"), address(baseRouter));
    baseRouter.enrollRemoteRouter(OP_DOMAIN, address(opRouter).addressToBytes32());
    vm.stopPrank();

    vm.selectFork(opFork);
  }

  // solhint-disable func-name-mixedcase

  function test_transferRemote_burnsAndMints_opToBase() external {
    address sender = makeAddr("sender");
    address receiver = makeAddr("receiver");
    uint256 amount = 100e18;
    uint256 supplyBefore = exy.totalSupply();

    vm.prank(acct("deployer"));
    exy.transfer(sender, amount);

    uint256 fee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(sender, fee);
    vm.prank(sender);
    opRouter.transferRemote{ value: fee }(BASE_DOMAIN, receiver.addressToBytes32(), amount);

    assertEq(exy.balanceOf(sender), 0, "sender balance != 0");
    assertEq(exy.totalSupply(), supplyBefore - amount, "op supply != supplyBefore - amount");

    // hack handle has onlyMailbox modifier
    vm.selectFork(baseFork);
    vm.prank(BASE_MAILBOX);
    baseRouter.handle(
      OP_DOMAIN, address(opRouter).addressToBytes32(), abi.encodePacked(receiver.addressToBytes32(), amount)
    );

    assertEq(exy.balanceOf(receiver), amount, "receiver balance != amount");
    assertEq(exy.totalSupply(), amount, "base supply != amount");
  }

  function test_transferRemote_burnsAndMints_baseToOp() external {
    address sender = makeAddr("sender");
    address receiver = makeAddr("receiver");
    uint256 amount = 100e18;
    uint256 opSupplyBefore = exy.totalSupply();

    // bridge op→base so sender has tokens on base
    vm.prank(acct("deployer"));
    exy.transfer(sender, amount);

    uint256 opFee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(sender, opFee);
    vm.prank(sender);
    opRouter.transferRemote{ value: opFee }(BASE_DOMAIN, sender.addressToBytes32(), amount);

    assertEq(exy.totalSupply(), opSupplyBefore - amount, "op supply != opSupplyBefore - amount");

    vm.selectFork(baseFork);
    vm.prank(BASE_MAILBOX); // hack handle has onlyMailbox modifier
    baseRouter.handle(
      OP_DOMAIN, address(opRouter).addressToBytes32(), abi.encodePacked(sender.addressToBytes32(), amount)
    );
    assertEq(exy.balanceOf(sender), amount, "sender balance != amount");
    assertEq(exy.totalSupply(), amount, "base supply != amount");

    // bridge base→op
    uint256 baseFee = baseRouter.quoteGasPayment(OP_DOMAIN);
    vm.deal(sender, baseFee);
    vm.prank(sender);
    baseRouter.transferRemote{ value: baseFee }(OP_DOMAIN, receiver.addressToBytes32(), amount);

    assertEq(exy.balanceOf(sender), 0, "sender balance != 0");
    assertEq(exy.totalSupply(), 0, "base supply != 0");

    vm.selectFork(opFork);
    vm.prank(OP_MAILBOX); // hack handle has onlyMailbox modifier
    opRouter.handle(
      BASE_DOMAIN, address(baseRouter).addressToBytes32(), abi.encodePacked(receiver.addressToBytes32(), amount)
    );

    assertEq(exy.balanceOf(receiver), amount, "receiver balance != amount");
    assertEq(exy.totalSupply(), opSupplyBefore, "op supply != opSupplyBefore");
  }

  function test_transferRemote_reverts_withoutBridgeRole() external {
    address sender = makeAddr("sender");
    uint256 amount = 100e18;

    vm.prank(admin);
    exy.revokeRole(keccak256("BRIDGE_ROLE"), address(opRouter));

    vm.prank(acct("deployer"));
    exy.transfer(sender, amount);

    uint256 fee = opRouter.quoteGasPayment(BASE_DOMAIN);
    vm.deal(sender, fee);
    vm.prank(sender);
    vm.expectRevert();
    opRouter.transferRemote{ value: fee }(BASE_DOMAIN, makeAddr("receiver").addressToBytes32(), amount);
  }

  function test_handle_reverts_withoutBridgeRole() external {
    vm.selectFork(baseFork);

    vm.prank(admin);
    exy.revokeRole(keccak256("BRIDGE_ROLE"), address(baseRouter));

    vm.prank(BASE_MAILBOX);
    vm.expectRevert();
    baseRouter.handle(
      OP_DOMAIN,
      address(opRouter).addressToBytes32(),
      abi.encodePacked(makeAddr("receiver").addressToBytes32(), uint256(100e18))
    );
  }

  // solhint-enable func-name-mixedcase
}
