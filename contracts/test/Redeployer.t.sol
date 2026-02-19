// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { Ownable } from "openzeppelin-contracts/contracts/access/Ownable.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import {
  ITransparentUpgradeableProxy
} from "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { PublicKey } from "webauthn-owner-plugin/IWebauthnOwnerPlugin.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";

import { AdminIsDeployer, Redeployer, TargetNonceTooLow } from "../script/Redeployer.s.sol";
import { EXY } from "../src/EXY.sol";
import { EXYv2 } from "../src/EXYv2.sol";
import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import { ExaPlugin } from "../src/ExaPlugin.sol";
import { ProposalManager } from "../src/ProposalManager.sol";

contract RedeployerTest is ForkTest {
  Redeployer public redeployer;

  // solhint-disable func-name-mixedcase
  function test_deployEXA_deploysAtSameAddress_onBase() external {
    vm.createSelectFork("base", 41_053_217);

    redeployer = new Redeployer();

    address deployer = acct("deployer");
    address exaOP = protocol("EXA", true, 10);
    uint256 targetNonce = redeployer.findNonce(deployer, exaOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");

    redeployer.prepare();
    redeployer.run(targetNonce + 1);

    assertTrue(exaOP.code.length > 0, "EXA not deployed at same address");

    redeployer.deployEXA(exaOP);

    EXA token = EXA(exaOP);
    assertEq(token.name(), "exactly");
    assertEq(token.symbol(), "EXA");
    assertEq(token.totalSupply(), 10_000_000e18, "token should have same minted supply");
    assertEq(token.balanceOf(address(redeployer.proxyAdmin())), 10_000_000e18, "ProxyAdmin should have tokens");
    assertEq(token.decimals(), 18, "token should have 18 decimals");
  }

  function test_run_reverts_whenAttackerUpgradesProxy() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    uint256 target = vm.getNonce(deployer) + 10;
    redeployer = new Redeployer();
    redeployer.prepare();
    redeployer.run(target);

    address proxy = vm.computeCreateAddress(deployer, target - 1);
    assertTrue(proxy.code.length > 0, "proxy not deployed");

    ProxyAdmin proxyAdmin = redeployer.proxyAdmin();
    EXA exa = new EXA();

    address attacker = address(0xbad);
    vm.prank(attacker);
    vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));

    redeployer.deployEXA(proxy);

    assertEq(EXA(proxy).name(), "exactly");
  }

  function test_prepare_reverts_whenAdminIsDeployer() external {
    vm.createSelectFork("optimism_sepolia", 39_900_000);

    redeployer = new Redeployer();
    vm.expectRevert(AdminIsDeployer.selector);
    redeployer.prepare();
  }

  function test_run_reverts_whenTargetNonceTooLow() external {
    vm.createSelectFork("base", 41_053_217);

    redeployer = new Redeployer();
    redeployer.prepare();
    vm.expectRevert(TargetNonceTooLow.selector);
    redeployer.run(0);
  }

  function test_deployExaFactory_deploysAtSameAddress_onEthereum() external {
    address factoryOP = 0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668;

    vm.createSelectFork("mainnet", 24_328_200);

    redeployer = new Redeployer();

    address deployer = acct("deployer");
    uint256 targetNonce = redeployer.findNonce(deployer, factoryOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");

    redeployer.prepare();
    redeployer.run(targetNonce + 1);

    assertTrue(factoryOP.code.length > 0, "factory not deployed at same address");

    IERC20 usdc = IERC20(protocol("USDC"));

    redeployer.deployExaFactory(factoryOP);

    vm.startPrank(acct("admin"));
    ProposalManager(
        address(ExaPlugin(payable(address(ExaAccountFactory(payable(factoryOP)).EXA_PLUGIN()))).proposalManager())
      ).allowTarget(address(usdc), true);
    vm.stopPrank();

    PublicKey[] memory owners = new PublicKey[](1);
    owners[0] = PublicKey({
      x: 7_069_542_735_213_499_944_382_077_471_664_383_693_469_693_907_948_845_929_105_962_569_513_088_837_587,
      y: 109_447_313_708_148_764_580_619_319_745_128_534_523_804_427_244_103_263_888_763_245_366_360_252_254_529
    });

    address expectedAccount = 0xa5a43E7ba1C106455b643D8fBb39c81Ca1b57c67;
    address account = ExaAccountFactory(payable(factoryOP)).createAccount(0, owners);
    assertEq(account, expectedAccount, "account != expected");

    uint256 amount = usdc.balanceOf(account);
    assertGt(amount, 0, "account USDC == 0");

    address receiver = makeAddr("receiver");
    vm.prank(account);
    UpgradeableModularAccount(payable(account))
      .execute(address(usdc), 0, abi.encodeCall(IERC20.transfer, (receiver, amount)));
    assertEq(usdc.balanceOf(receiver), amount, "receiver should have USDC");
  }

  function test_deployExaFactory_deploysAtSameAddress_onPolygon() external {
    address factoryOP = 0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668;

    vm.createSelectFork("polygon", 82_000_000);

    redeployer = new Redeployer();

    address deployer = acct("deployer");
    uint256 targetNonce = redeployer.findNonce(deployer, factoryOP, 1_000_000);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");

    IERC20 usdc = IERC20(0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359);

    redeployer.prepare();
    redeployer.run(targetNonce + 1);

    assertTrue(factoryOP.code.length > 0, "factory not deployed at same address");

    redeployer.deployExaFactory(factoryOP);
    ProposalManager p = ProposalManager(
      address(ExaPlugin(payable(address(ExaAccountFactory(payable(factoryOP)).EXA_PLUGIN()))).proposalManager())
    );
    assertTrue(p.allowlist(acct("swapper")), "swapper should be in allowlist");
    vm.startPrank(acct("admin"));
    p.allowTarget(address(usdc), true);
    vm.stopPrank();

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
    UpgradeableModularAccount(payable(account))
      .execute(address(usdc), 0, abi.encodeCall(IERC20.transfer, (receiver, amount)));
    assertEq(usdc.balanceOf(receiver), amount, "receiver should have USDC");
  }

  function test_deployExaFactory_deploysViaCreate3AtSameAddress_onPolygon() external {
    address factoryBase = 0xAd92a288CE0cc869129cDA518Af2baaf69fFa026;
    address accountBase = 0xeC6EE8939C1230742eCe9571319037767F574754;

    vm.createSelectFork("polygon", 82_000_000);

    redeployer = new Redeployer();
    ExaAccountFactory factory = redeployer.deployExaFactory();

    assertEq(address(factory), factoryBase, "factory != expected");

    PublicKey[] memory owners = new PublicKey[](1);
    owners[0] = PublicKey({ x: 1_377_837_249_724_728_941_829_967_018_498_619_894_891_941_074_907, y: 0 });

    address account = factory.createAccount(0, owners);
    assertEq(account, accountBase, "account != expected");
  }

  function test_recoversNativeETHOnPolygon() external {
    address accountBase = 0xeC6EE8939C1230742eCe9571319037767F574754;

    vm.createSelectFork("polygon", 82_000_000);
    vm.deal(accountBase, 1 ether);

    redeployer = new Redeployer();
    ExaAccountFactory factory = redeployer.deployExaFactory();

    PublicKey[] memory owners = new PublicKey[](1);
    owners[0] = PublicKey({ x: 1_377_837_249_724_728_941_829_967_018_498_619_894_891_941_074_907, y: 0 });

    address account = factory.createAccount(0, owners);
    assertEq(account, accountBase, "account != expected");

    address receiver = address(0x420);
    vm.startPrank(acct("admin"));
    ProposalManager(address(ExaPlugin(payable(address(factory.EXA_PLUGIN()))).proposalManager()))
      .allowTarget(receiver, true);
    vm.stopPrank();

    vm.prank(account);
    UpgradeableModularAccount(payable(account)).execute(receiver, 1 ether, new bytes(4));
    assertEq(receiver.balance, 1 ether, "receiver should have ETH");
  }

  function test_upgradeEXY_addsBridgeRole_onOptimism() external {
    vm.createSelectFork("optimism", 147_965_000);

    address proxy = 0xE86f49CB2D19e5Dfc38baCCCa721B28Abc70527c;
    ProxyAdmin pa = ProxyAdmin(0x6B40e8F40DA63E57b1AbCF1ce0Bb376832A4D7bE);
    address admin = acct("admin");

    assertEq(EXY(proxy).name(), "exy");
    assertEq(EXY(proxy).totalSupply(), 10_000_000e18);

    EXYv2 impl = new EXYv2();
    vm.prank(acct("deployer"));
    pa.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(impl), abi.encodeCall(EXYv2.initializeV2, (admin)));

    EXYv2 token = EXYv2(proxy);
    assertEq(token.name(), "exy");
    assertEq(token.totalSupply(), 10_000_000e18);
    assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), admin));

    address bridge = makeAddr("bridge");
    vm.prank(admin);
    token.grantRole(keccak256("BRIDGE_ROLE"), bridge);

    address receiver = makeAddr("receiver");
    vm.startPrank(bridge);
    token.mint(receiver, 1e18);
    assertEq(token.totalSupply(), 10_000_001e18);
    token.burn(receiver, 1e18);
    assertEq(token.totalSupply(), 10_000_000e18);
    vm.stopPrank();
  }

  function test_deployEXYv2_deploysAtSameAddress_onBase() external {
    address exyOP = 0xE86f49CB2D19e5Dfc38baCCCa721B28Abc70527c;

    vm.createSelectFork("base", 42_370_000);

    redeployer = new Redeployer();

    address deployer = acct("deployer");
    address admin = acct("admin");
    uint256 targetNonce = redeployer.findNonce(deployer, exyOP, 1_000_000);

    redeployer.prepare();
    redeployer.run(targetNonce + 1);

    assertTrue(exyOP.code.length > 0, "proxy not deployed at same address");

    EXYv2 impl = new EXYv2();
    redeployer.upgrade(exyOP, address(impl), abi.encodeCall(EXYv2.initialize, (admin)));

    EXYv2 token = EXYv2(exyOP);
    assertEq(token.name(), "exy");
    assertEq(token.symbol(), "EXY");
    assertEq(token.totalSupply(), 0, "base should have zero supply");
    assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), admin));

    address bridge = makeAddr("bridge");
    vm.prank(admin);
    token.grantRole(keccak256("BRIDGE_ROLE"), bridge);

    address receiver = makeAddr("receiver");
    vm.startPrank(bridge);
    token.mint(receiver, 1e18);
    assertEq(token.totalSupply(), 1e18);
    token.burn(receiver, 1e18);
    assertEq(token.totalSupply(), 0);
    vm.stopPrank();
  }

  // solhint-enable func-name-mixedcase
}
