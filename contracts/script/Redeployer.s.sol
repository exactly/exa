// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {
  TransparentUpgradeableProxy
} from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import {
  ITransparentUpgradeableProxy
} from "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { IPlugin, PluginMetadata } from "modular-account-libs/interfaces/IPlugin.sol";

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
import { MarketData } from "../src/IExaAccount.sol";
import { IssuerChecker } from "../src/IssuerChecker.sol";
import { ProposalManager } from "../src/ProposalManager.sol";
import { BaseScript } from "./Base.s.sol";

/// @title Redeployer
/// @notice Deploys transparent proxies to consume deployer nonces, enabling same-address deployments across chains.
contract Redeployer is BaseScript {
  EXA public exa;
  Dummy public dummy;
  ProxyAdmin public proxyAdmin;
  IAuditor public auditor;
  IMarket public marketUSDC;
  IMarket public marketWETH;

  /// @notice Loads pre-deployed contracts from CREATE3 and resolves protocol dependencies.
  function setUp() external {
    address admin = acct("admin");
    exa = EXA(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("EXA"))));
    dummy = Dummy(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("Dummy"))));
    proxyAdmin = ProxyAdmin(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("ProxyAdmin"))));
    auditor = IAuditor(_protocolOrStub("Auditor", "StubAuditor"));
    marketUSDC = IMarket(_protocolOrStub("MarketUSDC", "StubMarketUSDC"));
    marketWETH = IMarket(_protocolOrStub("MarketWETH", "StubMarketWETH"));
  }

  /// @notice Deploys dummy implementation, proxy admin, and protocol stubs via CREATE3.
  function prepare() external {
    address admin = acct("admin");
    if (admin == acct("deployer")) revert AdminIsDeployer();
    vm.startBroadcast(admin);
    dummy = Dummy(CREATE3_FACTORY.deploy(keccak256(abi.encode("Dummy")), vm.getCode("Redeployer.s.sol:Dummy")));
    proxyAdmin = ProxyAdmin(
      CREATE3_FACTORY.deploy(
        keccak256(abi.encode("ProxyAdmin")),
        abi.encodePacked(vm.getCode("ProxyAdmin.sol:ProxyAdmin"), abi.encode(admin))
      )
    );
    if (address(auditor).code.length == 0) {
      auditor = IAuditor(
        CREATE3_FACTORY.deploy(keccak256(abi.encode("StubAuditor")), vm.getCode("Redeployer.s.sol:StubAuditor"))
      );
      address stubAsset =
        CREATE3_FACTORY.deploy(keccak256(abi.encode("StubAsset")), vm.getCode("Redeployer.s.sol:StubAsset"));
      marketUSDC = IMarket(
        CREATE3_FACTORY.deploy(
          keccak256(abi.encode("StubMarketUSDC")),
          abi.encodePacked(vm.getCode("Redeployer.s.sol:StubMarket"), abi.encode(stubAsset))
        )
      );
      marketWETH = IMarket(
        CREATE3_FACTORY.deploy(
          keccak256(abi.encode("StubMarketWETH")),
          abi.encodePacked(vm.getCode("Redeployer.s.sol:StubMarket"), abi.encode(stubAsset))
        )
      );
    }
    vm.stopBroadcast();
  }

  /// @notice Deploys proxies with dummy implementation, consuming deployer nonces
  /// @param targetNonce The nonce to stop at (inclusive)
  /// @return start The starting nonce
  function run(uint256 targetNonce) external returns (uint256 start) {
    if (address(dummy).code.length == 0) revert DummyNotDeployed();
    if (address(proxyAdmin).code.length == 0) revert ProxyAdminNotDeployed();

    address deployer = acct("deployer");

    start = vm.getNonce(deployer);
    if (targetNonce < start) revert TargetNonceTooLow();

    vm.startBroadcast(deployer);
    for (uint256 nonce = start; nonce < targetNonce + 1; ++nonce) {
      address proxy = address(new TransparentUpgradeableProxy(address(dummy), address(proxyAdmin), ""));
      vm.label(proxy, string.concat("Proxy", vm.toString(nonce)));
    }
    vm.stopBroadcast();
  }

  /// @notice Upgrades a proxy to a new implementation.
  function upgrade(address proxy, address implementation, bytes calldata initData) external {
    vm.broadcast(acct("admin"));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), implementation, initData);
  }

  /// @notice Deploys EXA token and upgrades the proxy to it.
  function deployEXA(address proxy) external {
    vm.startBroadcast(acct("admin"));
    exa = EXA(CREATE3_FACTORY.deploy(keccak256(abi.encode("EXA")), vm.getCode("EXA.sol:EXA")));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));
    vm.stopBroadcast();
  }

  /// @notice Deploys ExaAccountFactory with all dependencies and upgrades the proxy to it.
  function deployExaFactory(address proxy) external {
    address admin = acct("admin");
    vm.startBroadcast(admin);
    (IPlugin ownerPlugin, IPlugin exaPlugin) = _deployPlugins(admin);
    proxyAdmin.upgradeAndCall(
      ITransparentUpgradeableProxy(proxy),
      address(new ExaAccountFactory(admin, ownerPlugin, exaPlugin, ACCOUNT_IMPL, ENTRYPOINT)),
      ""
    );
    vm.stopBroadcast();
  }

  /// @notice Deploys ExaAccountFactory with all dependencies via CREATE3.
  function deployExaFactory(string memory version) external returns (ExaAccountFactory factory) {
    address admin = acct("admin");
    vm.startBroadcast(admin);
    (IPlugin ownerPlugin, IPlugin exaPlugin) = _deployPlugins(admin);
    factory = ExaAccountFactory(
      payable(CREATE3_FACTORY.deploy(
          keccak256(abi.encode("Exa Plugin", version)),
          abi.encodePacked(
            vm.getCode("ExaAccountFactory.sol:ExaAccountFactory"),
            abi.encode(admin, ownerPlugin, exaPlugin, ACCOUNT_IMPL, ENTRYPOINT)
          )
        ))
    );
    vm.stopBroadcast();
  }

  /// @notice Finds the nonce at which `account` would deploy to `target` via CREATE.
  function findNonce(address account, address target, uint256 stop) public pure returns (uint256) {
    for (uint256 nonce = 0; nonce < stop; ++nonce) {
      if (vm.computeCreateAddress(account, nonce) == target) return nonce;
    }
    revert NonceNotFound();
  }

  function _protocolOrStub(string memory name, string memory stub) internal returns (address addr) {
    addr = protocol(name, false);
    if (addr == address(0)) addr = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode(stub)));
  }

  function _allowlist() internal returns (address[] memory targets) {
    string memory deploy = vm.readFile("deploy.json"); // forge-lint: disable-line(unsafe-cheatcode)
    string memory key = string.concat(".proposalManager.allowlist.", vm.toString(block.chainid));
    string[] memory keys = vm.keyExistsJson(deploy, key) ? vm.parseJsonKeys(deploy, key) : new string[](0);
    targets = new address[](keys.length + 1);
    targets[0] = acct("swapper");
    for (uint256 i = 0; i < keys.length; ++i) {
      targets[i + 1] = vm.parseAddress(keys[i]);
    }
  }

  function _deployPlugins(address admin) internal returns (IPlugin, IPlugin) {
    if (address(auditor).code.length == 0) revert NotPrepared();

    WebauthnOwnerPlugin ownerPlugin = new WebauthnOwnerPlugin();

    ProposalManager proposalManager = new ProposalManager(
      admin, auditor, IDebtManager(address(1)), IInstallmentsRouter(address(1)), admin, _allowlist(), 1
    );

    ExaPlugin exaPlugin = new ExaPlugin(
      Parameters({
        owner: admin,
        auditor: auditor,
        exaUSDC: marketUSDC,
        exaWETH: marketWETH,
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

    return (IPlugin(address(ownerPlugin)), IPlugin(address(exaPlugin)));
  }
}

error AdminIsDeployer();
error DummyNotDeployed();
error NonceNotFound();
error NotPrepared();
error ProxyAdminNotDeployed();
error TargetNonceTooLow();

contract Dummy { } // solhint-disable-line no-empty-blocks

contract StubAsset {
  function approve(address, uint256) external pure returns (bool) {
    return true;
  }
}

contract StubAuditor {
  function markets(IMarket) external pure returns (MarketData memory) { } // solhint-disable-line no-empty-blocks
}

contract StubMarket {
  /// forge-lint: disable-next-item(screaming-snake-case-immutable)
  address public immutable asset; // solhint-disable-line immutable-vars-naming

  constructor(address asset_) {
    asset = asset_;
  }
}
