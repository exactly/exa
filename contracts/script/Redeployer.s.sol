// SPDX-License-Identifier: AGPL-3.0
pragma solidity ^0.8.0;

import {
  TransparentUpgradeableProxy
} from "@openzeppelin/contracts-v4/proxy/transparent/TransparentUpgradeableProxy.sol";
import { ERC1967Utils } from "openzeppelin-contracts/contracts/proxy/ERC1967/ERC1967Utils.sol";
import { ProxyAdmin } from "openzeppelin-contracts/contracts/proxy/transparent/ProxyAdmin.sol";
import {
  ITransparentUpgradeableProxy
} from "openzeppelin-contracts/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

import { IPlugin, PluginMetadata } from "modular-account-libs/interfaces/IPlugin.sol";

import { ACCOUNT_IMPL, ENTRYPOINT } from "webauthn-owner-plugin/../script/Factory.s.sol";

import { EXA } from "@exactly/protocol/periphery/EXA.sol";

import { HypERC20Collateral } from "@hyperlane-xyz/core/contracts/token/HypERC20Collateral.sol";
import { HypXERC20 } from "@hyperlane-xyz/core/contracts/token/extensions/HypXERC20.sol";

import { ExaAccountFactory } from "../src/ExaAccountFactory.sol";
import {
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
  IPlugin public ownerPlugin;
  IPlugin public exaPlugin;
  ExaAccountFactory public factory;

  /// @notice Loads pre-deployed contracts and resolves protocol dependencies.
  function setUp() external {
    address admin = acct("admin");
    exa = EXA(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("EXA"))));
    dummy = Dummy(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("Dummy"))));
    proxyAdmin = ProxyAdmin(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("ProxyAdmin"))));
    ownerPlugin =
      IPlugin(_broadcastOrCreate3("node_modules/webauthn-owner-plugin/broadcast/Plugin", "WebauthnOwnerPlugin"));
    exaPlugin = IPlugin(_broadcastOrCreate3("broadcast/ExaPlugin", "ExaPlugin"));
    factory = _factory();
    auditor = IAuditor(_protocolOrStub("Auditor", "StubAuditor"));
    marketUSDC = IMarket(_protocolOrStub("MarketUSDC", "StubMarketUSDC"));
    marketWETH = IMarket(_protocolOrStub("MarketWETH", "StubMarketWETH"));
  }

  /// @notice Deploys all reusable contracts via CREATE3, skipping any already deployed.
  function prepare() external {
    address admin = acct("admin");
    if (admin == acct("deployer")) revert AdminIsDeployer();
    vm.startBroadcast(admin);
    if (address(dummy).code.length == 0) {
      dummy = Dummy(CREATE3_FACTORY.deploy(keccak256(abi.encode("Dummy")), vm.getCode("Redeployer.s.sol:Dummy")));
    }
    if (address(proxyAdmin).code.length == 0) {
      proxyAdmin = ProxyAdmin(
        CREATE3_FACTORY.deploy(
          keccak256(abi.encode("ProxyAdmin")),
          abi.encodePacked(vm.getCode("ProxyAdmin.sol:ProxyAdmin"), abi.encode(admin))
        )
      );
    }
    if (address(auditor).code.length == 0) {
      auditor = IAuditor(
        CREATE3_FACTORY.deploy(keccak256(abi.encode("StubAuditor")), vm.getCode("Redeployer.s.sol:StubAuditor"))
      );
    }
    if (address(marketUSDC).code.length == 0 || address(marketWETH).code.length == 0) {
      address stubAsset = CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("StubAsset")));
      if (stubAsset.code.length == 0) {
        stubAsset = CREATE3_FACTORY.deploy(keccak256(abi.encode("StubAsset")), vm.getCode("Redeployer.s.sol:StubAsset"));
      }
      if (address(marketUSDC).code.length == 0) {
        marketUSDC = IMarket(
          CREATE3_FACTORY.deploy(
            keccak256(abi.encode("StubMarketUSDC")),
            abi.encodePacked(vm.getCode("Redeployer.s.sol:StubMarket"), abi.encode(stubAsset))
          )
        );
      }
      if (address(marketWETH).code.length == 0) {
        marketWETH = IMarket(
          CREATE3_FACTORY.deploy(
            keccak256(abi.encode("StubMarketWETH")),
            abi.encodePacked(vm.getCode("Redeployer.s.sol:StubMarket"), abi.encode(stubAsset))
          )
        );
      }
    }
    if (address(ownerPlugin).code.length == 0) {
      ownerPlugin = IPlugin(
        CREATE3_FACTORY.deploy(
          keccak256(abi.encode("WebauthnOwnerPlugin")), vm.getCode("WebauthnOwnerPlugin.sol:WebauthnOwnerPlugin")
        )
      );
    }
    address proposalManagerAddr = _broadcastOrCreate3("broadcast/ProposalManager", "ProposalManager");
    if (proposalManagerAddr.code.length == 0) {
      proposalManagerAddr = CREATE3_FACTORY.deploy(
        keccak256(abi.encode("ProposalManager")),
        abi.encodePacked(
          vm.getCode("ProposalManager.sol:ProposalManager"),
          abi.encode(admin, auditor, IDebtManager(address(1)), IInstallmentsRouter(address(1)), admin, _allowlist(), 1)
        )
      );
    }
    if (address(exaPlugin).code.length == 0) {
      exaPlugin = IPlugin(
        CREATE3_FACTORY.deploy(
          keccak256(abi.encode("ExaPlugin")),
          abi.encodePacked(
            vm.getCode("ExaPlugin.sol:ExaPlugin"),
            abi.encode(
              Parameters({
                owner: admin,
                auditor: auditor,
                exaUSDC: marketUSDC,
                exaWETH: marketWETH,
                flashLoaner: IFlashLoaner(address(1)),
                debtManager: IDebtManager(address(1)),
                installmentsRouter: IInstallmentsRouter(address(1)),
                issuerChecker: IssuerChecker(address(1)),
                proposalManager: IProposalManager(proposalManagerAddr),
                collector: admin,
                swapper: admin,
                firstKeeper: admin
              })
            )
          )
        )
      );
    }
    if (!ProposalManager(proposalManagerAddr).hasRole(keccak256("PROPOSER_ROLE"), address(exaPlugin))) {
      ProposalManager(proposalManagerAddr).grantRole(keccak256("PROPOSER_ROLE"), address(exaPlugin));
    }
    if (address(factory).code.length == 0) {
      factory = ExaAccountFactory(
        payable(CREATE3_FACTORY.deploy(
            keccak256(abi.encode("ExaAccountFactory")),
            abi.encodePacked(
              vm.getCode("ExaAccountFactory.sol:ExaAccountFactory"),
              abi.encode(admin, ownerPlugin, exaPlugin, ACCOUNT_IMPL, ENTRYPOINT)
            )
          ))
      );
    }
    vm.stopBroadcast();
  }

  /// @notice Deploys proxies with dummy implementation, consuming deployer nonces.
  function proxyThrough(uint256 targetNonce) external returns (uint256 start) {
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
    address admin = acct("admin");
    vm.startBroadcast(admin);
    exa = EXA(CREATE3_FACTORY.deploy(keccak256(abi.encode("EXA")), vm.getCode("EXA.sol:EXA")));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize, ()));
    proxyAdmin.upgradeAndCall(
      ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize2, (admin))
    );
    vm.stopBroadcast();
  }

  /// @notice Deploys the latest EXA implementation via CREATE3.
  function deployEXAImpl() external {
    vm.broadcast(acct("admin"));
    exa = EXA(CREATE3_FACTORY.deploy(keccak256(abi.encode("EXA")), vm.getCode("EXA.sol:EXA")));
  }

  /// @notice Upgrades an existing EXA proxy to the latest implementation.
  function upgradeEXA(address proxy) external {
    address admin = acct("admin");
    ProxyAdmin p = ProxyAdmin(address(uint160(uint256(vm.load(proxy, ERC1967Utils.ADMIN_SLOT)))));
    vm.broadcast(p.owner());
    p.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(exa), abi.encodeCall(EXA.initialize2, (admin)));
  }

  function deployRouter(address token) external returns (HypXERC20 router) {
    address admin = acct("admin");
    router = HypXERC20(CREATE3_FACTORY.getDeployed(admin, keccak256(abi.encode("HypEXA"))));
    if (address(router).code.length != 0) return router;
    vm.startBroadcast(admin);
    router = HypXERC20(
      CREATE3_FACTORY.deploy(
        keccak256(abi.encode("HypEXA")),
        abi.encodePacked(
          type(TransparentUpgradeableProxy).creationCode,
          abi.encode(
            address(new HypXERC20(token, 1, 1, acct("mailbox"))),
            protocol("ProxyAdmin"),
            abi.encodeCall(HypERC20Collateral.initialize, (address(0), address(0), admin))
          )
        )
      )
    );
    router.transferOwnership(acct("exactly"));
    vm.stopBroadcast();
  }

  function setupRouter(uint32 remoteDomain) external {
    address router = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("HypEXA")));
    if (router.code.length == 0) revert RouterNotDeployed();
    vm.broadcast(acct("exactly"));
    HypXERC20(router).enrollRemoteRouter(remoteDomain, bytes32(uint256(uint160(router))));
  }

  /// @notice Upgrades a proxy to the cached ExaAccountFactory implementation.
  function deployExaFactory(address proxy) external {
    if (address(factory).code.length == 0) revert NotPrepared();
    if (address(uint160(uint256(vm.load(proxy, ERC1967Utils.IMPLEMENTATION_SLOT)))) == address(factory)) return;
    vm.broadcast(acct("admin"));
    proxyAdmin.upgradeAndCall(ITransparentUpgradeableProxy(proxy), address(factory), "");
  }

  /// @notice Deploys ExaAccountFactory at a version-specific CREATE3 address.
  function deployExaFactory(string calldata version) external returns (ExaAccountFactory f) {
    bytes32 salt = keccak256(abi.encode("Exa Plugin", version));
    f = ExaAccountFactory(payable(CREATE3_FACTORY.getDeployed(acct("admin"), salt)));
    if (address(f).code.length != 0) return f;
    if (address(ownerPlugin).code.length == 0 || address(exaPlugin).code.length == 0) revert NotPrepared();

    address admin = acct("admin");
    vm.startBroadcast(admin);
    f = ExaAccountFactory(
      payable(CREATE3_FACTORY.deploy(
          salt,
          abi.encodePacked(
            vm.getCode("ExaAccountFactory.sol:ExaAccountFactory"),
            abi.encode(admin, ownerPlugin, exaPlugin, ACCOUNT_IMPL, ENTRYPOINT)
          )
        ))
    );
    vm.stopBroadcast();
  }

  /// @notice Upgrades all factory proxies and deploys versioned factories via CREATE3.
  function deployExaFactories() external {
    this.deployExaFactory(0x8D493AF799162Ac3f273e8918B2842447f702163);
    this.deployExaFactory(0x6E1b5A67adD32E8dC034c23b8022b54821ED297b);
    this.deployExaFactory(0x3427a595eD6E05Cc2D8115e28BAd151cB879616e);
    this.deployExaFactory(0xcbeaAF42Cc39c17e84cBeFe85160995B515A9668);
    this.deployExaFactory("1.0.0");
    this.deployExaFactory("1.1.0");
  }

  /// @notice Finds the nonce at which `account` would deploy to `target` via CREATE.
  function findNonce(address account, address target, uint256 stop) public pure returns (uint256) {
    for (uint256 nonce = 0; nonce < stop; ++nonce) {
      if (vm.computeCreateAddress(account, nonce) == target) return nonce;
    }
    revert NonceNotFound();
  }

  function _broadcastOrCreate3(string memory path, string memory salt) internal returns (address addr) {
    // forge-lint: disable-next-line(unsafe-cheatcode)
    try vm.readFile(string.concat(path, ".s.sol/", vm.toString(block.chainid), "/run-latest.json")) returns (
      string memory json
    ) {
      try vm.parseJsonAddress(json, ".transactions[0].contractAddress") returns (address a) {
        addr = a;
      } catch { } // solhint-disable-line no-empty-blocks
    } catch { } // solhint-disable-line no-empty-blocks
    if (addr == address(0)) addr = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode(salt)));
  }

  function _factory() internal returns (ExaAccountFactory) {
    if (address(exaPlugin).code.length != 0) {
      PluginMetadata memory metadata = exaPlugin.pluginMetadata();
      address f = CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode(metadata.name, metadata.version)));
      if (f.code.length != 0) return ExaAccountFactory(payable(f));
    }
    return
      ExaAccountFactory(payable(CREATE3_FACTORY.getDeployed(acct("admin"), keccak256(abi.encode("ExaAccountFactory")))));
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
}

error AdminIsDeployer();
error DummyNotDeployed();
error NonceNotFound();
error NotPrepared();
error ProxyAdminNotDeployed();
error RouterNotDeployed();
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
