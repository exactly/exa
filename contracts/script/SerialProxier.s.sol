// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import { TransparentUpgradeableProxy } from
  "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import { ITransparentUpgradeableProxy } from
  "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { IPlugin } from "modular-account-libs/interfaces/IPlugin.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";
import { WebauthnOwnerPlugin } from "webauthn-owner-plugin/WebauthnOwnerPlugin.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";

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
import { BaseScript } from "./Base.s.sol";

contract SerialProxier is BaseScript {
  error NonceNotFound();
  error TargetNonceTooLow();

  Dummy public dummy;
  ProxyAdmin public proxyAdmin;

  function setUp() external {
    address admin = acct("admin");
    dummy = Dummy(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("Dummy"))));
    proxyAdmin = ProxyAdmin(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("ProxyAdmin"))));
  }

  function prepare() external {
    address admin = acct("admin");
    vm.startBroadcast(admin);
    dummy = Dummy(CREATE3_FACTORY.deploy(keccak256(abi.encode("Dummy")), vm.getCode("SerialProxier.s.sol:Dummy")));
    proxyAdmin = ProxyAdmin(
      CREATE3_FACTORY.deploy(
        keccak256(abi.encode("ProxyAdmin")),
        abi.encodePacked(vm.getCode("ProxyAdmin.sol:ProxyAdmin"), abi.encode(admin))
      )
    );
    vm.stopBroadcast();
  }

  /// @notice Deploys proxies with dummy implementation, consuming deployer nonces
  /// @param targetNonce The nonce to stop at (exclusive)
  /// @return start The starting nonce
  function run(uint256 targetNonce) external returns (uint256 start) {
    assert(address(dummy).code.length != 0);
    assert(address(proxyAdmin).code.length != 0);

    address deployer = acct("deployer");

    start = vm.getNonce(deployer);
    if (targetNonce <= start) revert TargetNonceTooLow();

    vm.startBroadcast(deployer);
    for (uint256 nonce = vm.getNonce(deployer); nonce < targetNonce; ++nonce) {
      address proxy = address(new TransparentUpgradeableProxy(address(dummy), address(proxyAdmin), ""));
      vm.label(proxy, string.concat("Proxy", vm.toString(nonce)));
    }
    vm.stopBroadcast();
  }

  function upgrade(address proxy, address implementation, bytes memory initData) external {
    vm.broadcast(acct("admin"));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), implementation, initData);
  }

  function deployEXA(address proxy) external {
    vm.startBroadcast(acct("admin"));
    EXA exa = new EXA();
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));
    vm.stopBroadcast();
  }

  function deployFactory(address proxy, FactoryParameters memory fp) external {
    address admin = acct("admin");

    vm.startBroadcast(admin);

    WebauthnOwnerPlugin ownerPlugin = new WebauthnOwnerPlugin();

    address[] memory allowlist = new address[](2);
    allowlist[0] = fp.exaUSDC.asset();
    allowlist[1] = fp.exaWETH.asset();
    ProposalManager proposalManager = new ProposalManager(
      admin, fp.auditor, IDebtManager(address(1)), IInstallmentsRouter(address(1)), admin, allowlist, 1
    );

    ExaPlugin exaPlugin = new ExaPlugin(
      Parameters({
        owner: admin,
        auditor: fp.auditor,
        exaUSDC: fp.exaUSDC,
        exaWETH: fp.exaWETH,
        flashLoaner: IFlashLoaner(address(1)),
        debtManager: IDebtManager(address(1)),
        installmentsRouter: IInstallmentsRouter(address(1)),
        issuerChecker: IssuerChecker(address(1)),
        proposalManager: IProposalManager(address(proposalManager)),
        collector: admin,
        swapper: admin,
        firstKeeper: admin
      })
    );

    proposalManager.grantRole(keccak256("PROPOSER_ROLE"), address(exaPlugin));

    ExaAccountFactory factory =
      new ExaAccountFactory(admin, IPlugin(address(ownerPlugin)), IPlugin(address(exaPlugin)), ACCOUNT_IMPL, ENTRYPOINT);

    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(factory), "");

    vm.stopBroadcast();
  }

  function findNonce(address account, address target, uint256 stop) public pure returns (uint256) {
    for (uint256 nonce = 0; nonce < stop; ++nonce) {
      if (vm.computeCreateAddress(account, nonce) == target) return nonce;
    }
    revert NonceNotFound();
  }
}

contract Dummy { }

struct FactoryParameters {
  IAuditor auditor;
  IMarket exaUSDC;
  IMarket exaWETH;
}
