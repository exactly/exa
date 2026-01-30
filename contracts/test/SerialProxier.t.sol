// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import { ITransparentUpgradeableProxy } from
  "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { PublicKey } from "webauthn-owner-plugin/IWebauthnOwnerPlugin.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";

import { SerialProxier, TargetNonceTooLow } from "../script/SerialProxier.s.sol";
import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import { ProposalManager } from "../src/ProposalManager.sol";

contract SerialProxierTest is ForkTest {
  SerialProxier public proxier;

  // solhint-disable func-name-mixedcase
  function test_deploysEXAAtSameAddressAsOPMainnet() external {
    vm.createSelectFork("base", 41_053_217);

    proxier = new SerialProxier();

    address deployer = acct("deployer");
    address exaOP = protocol("EXA", true, 10);
    uint256 targetNonce = proxier.findNonce(deployer, exaOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");

    proxier.prepare();
    proxier.run(targetNonce + 1);

    assertTrue(exaOP.code.length > 0, "EXA not deployed at same address");

    proxier.deployEXA(exaOP);

    EXA token = EXA(exaOP);
    assertEq(token.name(), "exactly");
    assertEq(token.symbol(), "EXA");
    assertEq(token.totalSupply(), 10_000_000e18, "token should have same minted supply");
    assertEq(token.balanceOf(address(proxier.proxyAdmin())), 10_000_000e18, "ProxyAdmin should have tokens");
    assertEq(token.decimals(), 18, "token should have 18 decimals");
  }

  function test_proxy_cannotBeStolen() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    uint256 target = vm.getNonce(deployer) + 10;
    proxier = new SerialProxier();
    proxier.prepare();
    proxier.run(target);

    address proxy = vm.computeCreateAddress(deployer, target - 1);
    assertTrue(proxy.code.length > 0, "proxy not deployed");

    ProxyAdmin proxyAdmin = proxier.proxyAdmin();
    EXA exa = new EXA();

    address attacker = address(0xbad);
    vm.prank(attacker);
    vm.expectRevert();
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));

    proxier.deployEXA(proxy);

    assertEq(EXA(proxy).name(), "exactly");
  }

  function test_revertsIfTargetNonceTooLow() external {
    vm.createSelectFork("base", 41_053_217);

    proxier = new SerialProxier();
    proxier.prepare();
    vm.expectRevert(TargetNonceTooLow.selector);
    proxier.run(0);
  }

  function test_deploysFactoryAndAccountAtSameAddressAsOPMainnet() external {
    address factoryOP = 0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668;

    vm.createSelectFork("mainnet", 24_328_200);

    proxier = new SerialProxier();

    address deployer = acct("deployer");
    uint256 targetNonce = proxier.findNonce(deployer, factoryOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");
    vm.setNonce(deployer, uint64(targetNonce - 10));

    proxier.prepare();
    proxier.run(targetNonce + 1);

    assertTrue(factoryOP.code.length > 0, "factory not deployed at same address");

    IERC20 usdc = IERC20(protocol("USDC"));

    proxier.deployExaFactory(factoryOP);

    ProposalManager pm = ProposalManager(
      address(ExaPlugin(payable(address(ExaAccountFactory(payable(factoryOP)).EXA_PLUGIN()))).proposalManager())
    );
    vm.prank(acct("admin"));
    pm.allowTarget(address(usdc), true);

    PublicKey[] memory owners = new PublicKey[](1);
    owners[0] = PublicKey({
      x: 7_069_542_735_213_499_944_382_077_471_664_383_693_469_693_907_948_845_929_105_962_569_513_088_837_587,
      y: 109_447_313_708_148_764_580_619_319_745_128_534_523_804_427_244_103_263_888_763_245_366_360_252_254_529
    });

    address expectedAccount = 0xa5a43E7ba1C106455b643D8fBb39c81Ca1b57c67;
    address account = ExaAccountFactory(payable(factoryOP)).createAccount(0, owners);
    assertEq(account, expectedAccount, "account != expected");

    address receiver = makeAddr("receiver");
    uint256 amount = usdc.balanceOf(account);
    vm.prank(account);
    UpgradeableModularAccount(payable(account)).execute(
      address(usdc), 0, abi.encodeCall(IERC20.transfer, (receiver, amount))
    );
    assertEq(usdc.balanceOf(receiver), amount, "receiver should have USDC");
  }

  function test_deploysFactoryAndAccountAtSameAddressOnPolygon() external {
    address factoryOP = 0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668;

    vm.createSelectFork("polygon", 82_000_000);

    proxier = new SerialProxier();

    address deployer = acct("deployer");
    uint256 targetNonce = proxier.findNonce(deployer, factoryOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");
    vm.setNonce(deployer, uint64(targetNonce - 10));

    IERC20 usdc = IERC20(0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359);

    proxier.prepare();
    proxier.run(targetNonce + 1);

    assertTrue(factoryOP.code.length > 0, "factory not deployed at same address");

    proxier.deployExaFactory(factoryOP);

    ProposalManager pm = ProposalManager(
      address(ExaPlugin(payable(address(ExaAccountFactory(payable(factoryOP)).EXA_PLUGIN()))).proposalManager())
    );
    vm.prank(acct("admin"));
    pm.allowTarget(address(usdc), true);

    PublicKey[] memory owners = new PublicKey[](1);
    owners[0] = PublicKey({
      x: 36_239_696_829_842_771_799_020_839_773_186_339_451_905_684_138_052_071_201_385_735_692_571_111_323_304,
      y: 68_346_061_821_485_004_327_752_959_192_465_308_812_504_725_568_244_017_761_086_739_549_382_760_577_121
    });

    address expectedAccount = 0xDAB3996c49b8D9e0197aa6cb265Ed736448bD24E;
    address account = ExaAccountFactory(payable(factoryOP)).createAccount(0, owners);
    assertEq(account, expectedAccount, "account != expected");

    uint256 amount = usdc.balanceOf(account);
    assertGt(amount, 0, "account USDC == 0");

    address receiver = makeAddr("receiver");
    vm.prank(account);
    UpgradeableModularAccount(payable(account)).execute(
      address(usdc), 0, abi.encodeCall(IERC20.transfer, (receiver, amount))
    );
    assertEq(usdc.balanceOf(receiver), amount, "receiver should have USDC");
  }
  // solhint-enable func-name-mixedcase
}
