// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { ForkTest } from "./Fork.t.sol";

import { TimelockController } from "@openzeppelin/contracts-v4/governance/TimelockController.sol";
import { ProxyAdmin } from "@openzeppelin/contracts-v4/proxy/transparent/ProxyAdmin.sol";
import { ITransparentUpgradeableProxy } from
  "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { IERC20 } from "openzeppelin-contracts/contracts/interfaces/IERC20.sol";

import { UpgradeableModularAccount } from "modular-account/src/account/UpgradeableModularAccount.sol";

import { IPlugin } from "modular-account-libs/interfaces/IPlugin.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { PublicKey } from "webauthn-owner-plugin/IWebauthnOwnerPlugin.sol";
import { WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";

import { Resetter, SerialProxier } from "../script/SerialProxier.s.sol";
import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import {
  ExaPlugin,
  IAuditor,
  IDebtManager,
  IFlashLoaner,
  IInstallmentsRouter,
  IMarket,
  IProposalManager,
  Parameters
} from "../src/ExaPlugin.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { ProposalManager } from "../src/ProposalManager.sol";

contract SerialProxierTest is ForkTest {
  SerialProxier public proxier;

  function setUp() external {
    proxier = new SerialProxier();
  }

  // solhint-disable func-name-mixedcase
  // solhint-disable gas-small-strings
  function test_deploysEXAAtSameAddressAsOPMainnet() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    address exaOP = protocol("EXA", true, 10);
    uint256 targetNonce = findNonce(deployer, exaOP);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");

    proxier = new SerialProxier();
    Resetter resetter = new Resetter();
    EXA exa = new EXA();

    proxier.run(targetNonce + 1);

    assertTrue(exaOP.code.length > 0, "EXA not deployed at same address");

    proxier.proposeUpgradeWithReset(exaOP, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));
    skip(TimelockController(payable(protocol("TimelockController"))).getMinDelay());
    proxier.executeUpgradeWithReset(exaOP, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));

    assertEq(EXA(exaOP).name(), "exactly");
    assertEq(EXA(exaOP).symbol(), "EXA");
  }

  function test_eachProxyConsumesOneNonce() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    uint256 target = vm.getNonce(deployer) + 10;
    proxier = new SerialProxier();
    proxier.run(target);

    assertEq(vm.getNonce(deployer), target, "should reach target nonce");
  }

  function test_proxy_cannotBeStolen() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    uint256 target = vm.getNonce(deployer) + 10;
    proxier = new SerialProxier();
    proxier.run(target);

    address proxy = vm.computeCreateAddress(deployer, target - 1);
    assertTrue(proxy.code.length > 0, "proxy not deployed");

    ProxyAdmin proxyAdmin = ProxyAdmin(protocol("ProxyAdmin"));
    Resetter resetter = new Resetter();
    EXA exa = new EXA();

    address attacker = address(0xbad);
    vm.prank(attacker);
    vm.expectRevert();
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));

    proxier.proposeUpgradeWithReset(proxy, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));
    skip(TimelockController(payable(protocol("TimelockController"))).getMinDelay());
    proxier.executeUpgradeWithReset(proxy, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));

    assertEq(EXA(proxy).name(), "exactly");
  }

  function test_proxy_canBeUsedAsEXAToken() external {
    vm.createSelectFork("base", 41_053_217);

    address deployer = acct("deployer");
    uint256 target = vm.getNonce(deployer) + 10;
    proxier = new SerialProxier();
    Resetter resetter = new Resetter();
    EXA exa = new EXA();

    proxier.run(target);

    address proxy = vm.computeCreateAddress(deployer, target - 1);

    proxier.proposeUpgradeWithReset(proxy, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));
    skip(TimelockController(payable(protocol("TimelockController"))).getMinDelay());
    proxier.executeUpgradeWithReset(proxy, address(exa), abi.encodeCall(EXA.initialize, ()), address(resetter));

    EXA token = EXA(proxy);

    assertEq(token.name(), "exactly", "token should have correct name");
    assertEq(token.symbol(), "EXA", "token should have correct symbol");
    assertEq(token.totalSupply(), 10_000_000e18, "token should have minted supply");

    assertEq(token.balanceOf(protocol("ProxyAdmin")), 10_000_000e18, "ProxyAdmin should have tokens");

    assertEq(token.decimals(), 18, "token should work as IERC20");
  }

  function test_revertsIfTargetNonceTooLow() external {
    vm.createSelectFork("base", 41_053_217);

    proxier = new SerialProxier();
    vm.expectRevert(SerialProxier.TargetNonceTooLow.selector);
    proxier.run(0);
  }

  function test_deploysFactoryAndAccountAtSameAddressAsOPMainnet() external {
    address factoryOP = 0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668;

    vm.createSelectFork("mainnet", 24_328_200);

    address deployer = acct("deployer");
    uint256 targetNonce = findNonce(deployer, factoryOP);
    uint256 currentNonce = vm.getNonce(deployer);
    assertGt(targetNonce, currentNonce, "target nonce <= current nonce");
    vm.setNonce(deployer, uint64(targetNonce - 10));

    proxier = new SerialProxier();
    proxier.run(targetNonce + 1);

    assertTrue(factoryOP.code.length > 0, "factory not deployed at same address");

    WebauthnOwnerPlugin ownerPlugin = new WebauthnOwnerPlugin();

    IERC20 usdc = IERC20(protocol("USDC"));
    IAuditor auditor = IAuditor(protocol("Auditor"));

    address[] memory allowlist = new address[](1);
    allowlist[0] = address(usdc);
    ProposalManager proposalManager = new ProposalManager(
      address(this), auditor, IDebtManager(address(2)), IInstallmentsRouter(address(3)), address(6), allowlist, 1
    );

    ExaPlugin exaPlugin = new ExaPlugin(
      Parameters({
        owner: address(this),
        auditor: auditor,
        exaUSDC: IMarket(protocol("MarketUSDC")),
        exaWETH: IMarket(protocol("MarketWETH")),
        flashLoaner: IFlashLoaner(address(1)),
        debtManager: IDebtManager(address(2)),
        installmentsRouter: IInstallmentsRouter(address(3)),
        issuerChecker: IssuerChecker(address(4)),
        proposalManager: IProposalManager(address(proposalManager)),
        collector: address(6),
        swapper: address(7),
        firstKeeper: address(8)
      })
    );

    proposalManager.grantRole(keccak256("PROPOSER_ROLE"), address(exaPlugin));

    ExaAccountFactory factory = new ExaAccountFactory(
      address(this), IPlugin(address(ownerPlugin)), IPlugin(address(exaPlugin)), ACCOUNT_IMPL, ENTRYPOINT
    );

    proxier.proposeUpgrade(factoryOP, address(factory), "");
    skip(TimelockController(payable(protocol("TimelockController"))).getMinDelay());
    proxier.executeUpgrade(factoryOP, address(factory), "");

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
  // solhint-enable gas-small-strings
  // solhint-enable func-name-mixedcase

  function findNonce(address account, address target) internal pure returns (uint256) {
    for (uint256 nonce = 0; nonce < 1_000_000; ++nonce) {
      if (vm.computeCreateAddress(account, nonce) == target) return nonce;
    }
    revert NonceNotFound();
  }
}

error NonceNotFound();
